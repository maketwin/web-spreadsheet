import { describe, expect, it } from 'vitest';
import { createFormulaSync } from '../../src/components/Spreadsheet';
import { FormulaEngine } from '../../src/formula/FormulaEngine';
import { Store } from '../../src/store/Store';
import { CommandManager } from '../../src/commands/CommandManager';
import { DeleteRowCommand } from '../../src/commands/impl/DeleteRow';
import { InsertRowCommand } from '../../src/commands/impl/InsertRow';
import { FillRangeCommand } from '../../src/commands/impl/FillRange';
import { MoveRange } from '../../src/commands/impl/MoveRange';
import { snapshotCells, buildSessionPasteValues } from '../../src/clipboard/session';
import { applyMatrix } from '../../src/util/rangeValues';

/**
 * Spill × structural operations (P1 regression suite). Spill shadows are
 * DERIVED state: every path that moves or copies cells as data must drop
 * them and let the shifted/pasted anchor re-spill. Transporting a shadow
 * leaves a stale value that blocks the re-spill (#SPILL! on the anchor) and
 * carries an anchor key that no longer hosts an anchor.
 */
function setup(seed?: (store: Store) => void): { store: Store; engine: FormulaEngine; unsubscribe: () => void } {
  const store = new Store();
  const engine = new FormulaEngine(store);
  const sync = createFormulaSync(store, engine);
  seed?.(store);
  return { store, engine, unsubscribe: sync.unsubscribe };
}

describe('spill × structural operations', () => {
  it('editing the anchor to a scalar formula retires all shadows', () => {
    const { store, unsubscribe } = setup((s) => { s.setCell(0, 0, { formula: '=SEQUENCE(3)', text: '' }); });
    try {
      expect(store.getCell(2, 0)?.spillOf).toBeDefined();
      // UI path: cell edit → sync → setFormula, no removeFormula first.
      store.setCell(0, 0, { formula: '=1+1', text: '' });
      expect(store.getCell(0, 0)?.text).toBe('2');
      expect(store.getCell(1, 0)).toBeUndefined();
      expect(store.getCell(2, 0)).toBeUndefined();
    } finally { unsubscribe(); }
  });

  it('deleting a row above the spill moves the anchor and re-spills fresh', () => {
    const { store, unsubscribe } = setup((s) => { s.setCell(5, 0, { formula: '=SEQUENCE(3)', text: '' }); });
    try {
      expect(store.getCell(6, 0)?.spillOf).toBe(`${store.getActiveSheetId()}:5,0`);
      new DeleteRowCommand({ r: 0 }).execute(store);
      const anchor = store.getCell(4, 0);
      expect(anchor?.formula).toBe('=SEQUENCE(3)');
      expect(anchor?.text).not.toBe('#SPILL!');
      for (let r = 4; r <= 6; r += 1) expect(Number(store.getCell(r, 0)?.text)).toBe(r - 3);
      expect(store.getCell(5, 0)?.spillOf).toBe(`${store.getActiveSheetId()}:4,0`);
      expect(store.getCell(6, 0)?.spillOf).toBe(`${store.getActiveSheetId()}:4,0`);
      expect(store.getCell(7, 0)).toBeUndefined();
    } finally { unsubscribe(); }
  });

  it('inserting a row above the spill moves the anchor and re-spills fresh', () => {
    const { store, unsubscribe } = setup((s) => { s.setCell(5, 0, { formula: '=SEQUENCE(3)', text: '' }); });
    try {
      new InsertRowCommand({ r: 1 }).execute(store);
      const anchor = store.getCell(6, 0);
      expect(anchor?.formula).toBe('=SEQUENCE(3)');
      expect(anchor?.text).not.toBe('#SPILL!');
      for (let r = 6; r <= 8; r += 1) expect(Number(store.getCell(r, 0)?.text)).toBe(r - 5);
      expect(store.getCell(7, 0)?.spillOf).toBe(`${store.getActiveSheetId()}:6,0`);
      expect(store.getCell(9, 0)).toBeUndefined();
    } finally { unsubscribe(); }
  });

  it('filling a spilled block down re-spills at the new anchor (Excel array fill)', () => {
    const { store, unsubscribe } = setup((s) => { s.setCell(0, 0, { formula: '=SEQUENCE(3)', text: '' }); });
    try {
      new FillRangeCommand({ source: { r1: 0, c1: 0, r2: 2, c2: 0 }, target: { r1: 0, c1: 0, r2: 5, c2: 0 } }).execute(store);
      const anchor = store.getCell(3, 0);
      expect(anchor?.formula).toBe('=SEQUENCE(3)');
      expect(anchor?.text).not.toBe('#SPILL!');
      for (let r = 3; r <= 5; r += 1) expect(Number(store.getCell(r, 0)?.text)).toBe(r - 2);
      expect(store.getCell(4, 0)?.spillOf).toBe(`${store.getActiveSheetId()}:3,0`);
      // The original anchor's spill is untouched.
      for (let r = 0; r <= 2; r += 1) expect(Number(store.getCell(r, 0)?.text)).toBe(r + 1);
    } finally { unsubscribe(); }
  });

  it('copy-pasting a spilled block re-spills at the destination', () => {
    const { store, unsubscribe } = setup((s) => { s.setCell(0, 0, { formula: '=SEQUENCE(3)', text: '' }); });
    try {
      const cmdManager = new CommandManager(store);
      const source = { r1: 0, c1: 0, r2: 2, c2: 0 };
      const session = { type: 'copy' as const, range: source, text: '', cells: snapshotCells(store, source) };
      applyMatrix(store, cmdManager, 0, 3, buildSessionPasteValues(session, 0, 3));
      const anchor = store.getCell(0, 3);
      expect(anchor?.formula).toBe('=SEQUENCE(3)');
      expect(anchor?.text).not.toBe('#SPILL!');
      for (let r = 0; r <= 2; r += 1) expect(Number(store.getCell(r, 3)?.text)).toBe(r + 1);
      expect(store.getCell(1, 3)?.spillOf).toBe(`${store.getActiveSheetId()}:0,3`);
    } finally { unsubscribe(); }
  });

  it('Ctrl-drag copying a spilled block re-spills at the target', () => {
    const { store, unsubscribe } = setup((s) => { s.setCell(0, 0, { formula: '=SEQUENCE(3)', text: '' }); });
    try {
      new MoveRange({ source: { r1: 0, c1: 0, r2: 2, c2: 0 }, target: { r1: 0, c1: 3, r2: 0, c2: 3 }, copy: true }).execute(store);
      const anchor = store.getCell(0, 3);
      expect(anchor?.formula).toBe('=SEQUENCE(3)');
      expect(anchor?.text).not.toBe('#SPILL!');
      for (let r = 0; r <= 2; r += 1) expect(Number(store.getCell(r, 3)?.text)).toBe(r + 1);
      // Copy keeps the source spill intact.
      for (let r = 0; r <= 2; r += 1) expect(Number(store.getCell(r, 0)?.text)).toBe(r + 1);
    } finally { unsubscribe(); }
  });

  it('spill shadows preserve the target cell\'s styleId and type', () => {
    const { store, unsubscribe } = setup((s) => {
      s.setStyle('st1', { bold: true });
      s.setCell(1, 0, { text: '', styleId: 'st1', type: 'number' });
      s.setCell(0, 0, { formula: '=SEQUENCE(3)', text: '' });
    });
    try {
      const shadow = store.getCell(1, 0);
      expect(shadow?.text).toBe('2');
      expect(shadow?.styleId).toBe('st1');
      expect(shadow?.type).toBe('number');
    } finally { unsubscribe(); }
  });

  it('spilled Date values keep their Date type in shadow cells', () => {
    const { store, unsubscribe } = setup((s) => {
      const d0 = new Date(2026, 0, 1);
      s.setCell(0, 0, { text: '2026/1/1', value: d0 });
      s.setCell(1, 0, { text: '2026/1/2', value: new Date(2026, 0, 2) });
      s.setCell(2, 0, { text: '2026/1/3', value: new Date(2026, 0, 3) });
      s.setCell(0, 1, { formula: '=FILTER(A1:A3,A1:A3>0)', text: '' });
    });
    try {
      expect(store.getCell(0, 1)?.value).toBeInstanceOf(Date);
      const shadow = store.getCell(1, 1);
      expect(shadow?.spillOf).toBeDefined();
      expect(shadow?.value).toBeInstanceOf(Date);
      expect((shadow?.value as Date).getDate()).toBe(2);
    } finally { unsubscribe(); }
  });

  it('IFERROR catches a blocked anchor\'s #SPILL!', () => {
    const { store, unsubscribe } = setup((s) => {
      s.setCell(1, 0, { text: 'blocker' });
      s.setCell(0, 0, { formula: '=SEQUENCE(3)', text: '' });
      s.setCell(0, 2, { formula: '=IFERROR(A1,"blocked")', text: '' });
    });
    try {
      expect(store.getCell(0, 0)?.text).toBe('#SPILL!');
      expect(store.getCell(0, 2)?.text).toBe('blocked');
    } finally { unsubscribe(); }
  });

  it('list × matrix element-wise math works (=SUM(A1:A3*SEQUENCE(3)) is 14)', () => {
    const { store, unsubscribe } = setup((s) => {
      s.setCell(0, 0, { text: '1' });
      s.setCell(1, 0, { text: '2' });
      s.setCell(2, 0, { text: '3' });
      s.setCell(0, 1, { formula: '=SUM(A1:A3*SEQUENCE(3))', text: '' });
      s.setCell(0, 2, { formula: '=SUM(SEQUENCE(3)*A1:A3)', text: '' });
    });
    try {
      expect(Number(store.getCell(0, 1)?.text)).toBe(14);
      expect(Number(store.getCell(0, 2)?.text)).toBe(14);
    } finally { unsubscribe(); }
  });

  it('deleting a sheet drops its spill bookkeeping without side effects', () => {
    const { store, unsubscribe } = setup();
    try {
      const s2 = store.addSheet('S2');
      store.activateSheet(s2);
      store.setCell(0, 0, { formula: '=SEQUENCE(3)', text: '' });
      expect(store.getCell(2, 0)?.spillOf).toBeDefined();
      store.deleteSheet(s2);
      store.setCell(0, 0, { formula: '=SEQUENCE(3)', text: '' });
      expect(Number(store.getCell(2, 0)?.text)).toBe(3);
    } finally { unsubscribe(); }
  });
});
