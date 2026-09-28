import { describe, expect, it } from 'vitest';
import { createFormulaSync } from '../../src/components/Spreadsheet';
import { FormulaEngine } from '../../src/formula/FormulaEngine';
import { Store } from '../../src/store/Store';
import { SetCellText } from '../../src/commands/impl/SetCellText';
import { cellId, formulaDependencies, formulaText } from '../../src/util/cell';

/**
 * Excel dynamic-array spill (P0-1): SEQUENCE/FILTER/UNIQUE/SORT write
 * multi-cell results into an anchored spill area; a blocker collapses the
 * spill to #SPILL! (recovering when cleared); deleting the anchor retracts
 * the shadows; other formulas can reference spilled cells.
 */
function setup(seed?: (store: Store) => void): { store: Store; engine: FormulaEngine; unsubscribe: () => void } {
  const store = new Store();
  const engine = new FormulaEngine(store);
  const sync = createFormulaSync(store, engine);
  seed?.(store);
  // Register formulas like the UI does on load (setCell during seed already
  // went through the sync; re-register is a no-op).
  store.getCells().forEach(([id, cell]) => {
    const formula = formulaText(cell);
    if (formula !== undefined) engine.setFormula(id, formula, formulaDependencies(formula));
  });
  return { store, engine, unsubscribe: sync.unsubscribe };
}

const anchorKey = (store: Store): string => `${store.getActiveSheetId()}:0,0`;

describe('dynamic array spill', () => {
  it('SEQUENCE(3,3) fills a 3×3 area with shadows pointing at the anchor', () => {
    const { store, unsubscribe } = setup((s) => { s.setCell(0, 0, { formula: '=SEQUENCE(3,3)', text: '' }); });
    try {
      for (let r = 0; r < 3; r += 1) {
        for (let c = 0; c < 3; c += 1) {
          const cell = store.getCell(r, c);
          expect(Number(cell?.text)).toBe(r * 3 + c + 1);
          if (r !== 0 || c !== 0) expect(cell?.spillOf).toBe(anchorKey(store));
        }
      }
      expect(store.getCell(3, 0)).toBeUndefined(); // nothing below the extent
    } finally { unsubscribe(); }
  });

  it('a blocker collapses the spill to #SPILL! and clearing it recovers', () => {
    const { store, unsubscribe } = setup((s) => {
      s.setCell(0, 3, { text: 'blocker' }); // D1
      s.setCell(0, 0, { formula: '=SEQUENCE(1,4)', text: '' }); // A1:D1
    });
    try {
      expect(store.getCell(0, 0)?.text).toBe('#SPILL!');
      expect(store.getCell(0, 1)).toBeUndefined(); // no shadows while blocked

      store.setCell(0, 3, undefined); // clear the blocker (sync → onCellChanged → anchor recalc)
      expect(store.getCell(0, 0)?.text).toBe('1');
      for (let c = 0; c < 4; c += 1) expect(Number(store.getCell(0, c)?.text)).toBe(c + 1);
    } finally { unsubscribe(); }
  });

  it('typing over a shadow collapses the spill; deleting the anchor retracts all shadows', () => {
    const { store, unsubscribe } = setup((s) => { s.setCell(0, 0, { formula: '=SEQUENCE(3)', text: '' }); });
    try {
      expect(store.getCell(2, 0)?.spillOf).toBe(anchorKey(store));

      // Overwrite the middle shadow with user content.
      store.setCell(1, 0, { text: 'mine' });
      expect(store.getCell(0, 0)?.text).toBe('#SPILL!');
      expect(store.getCell(2, 0)).toBeUndefined(); // shadows retracted
      expect(store.getCell(1, 0)?.text).toBe('mine'); // user content intact

      // Remove the anchor formula entirely.
      store.setCell(1, 0, undefined);
      store.setCell(0, 0, undefined);
      expect(store.getCell(0, 0)).toBeUndefined();
    } finally { unsubscribe(); }
  });

  it('FILTER spills the picked rows as a column vector', () => {
    const { store, unsubscribe } = setup((s) => {
      s.setCell(0, 0, { text: 'a' }); s.setCell(1, 0, { text: 'b' }); s.setCell(2, 0, { text: 'c' });
      s.setCell(0, 1, { formula: '=FILTER(A1:A3,A1:A3<>"b")', text: '' });
    });
    try {
      expect(store.getCell(0, 1)?.text).toBe('a');
      expect(store.getCell(1, 1)?.text).toBe('c');
      expect(store.getCell(2, 1)).toBeUndefined();
      expect(store.getCell(1, 1)?.spillOf).toBe(`${store.getActiveSheetId()}:0,1`);
    } finally { unsubscribe(); }
  });

  it('other formulas read spilled cells and aggregates flatten matrices', () => {
    const { store, unsubscribe } = setup((s) => {
      s.setCell(0, 0, { formula: '=SEQUENCE(3)', text: '' }); // A1:A3 = 1,2,3
      s.setCell(0, 2, { formula: '=A3*10', text: '' }); // reads a shadow → 30
      s.setCell(1, 2, { formula: '=SUM(SEQUENCE(3))', text: '' }); // nested aggregate → 6
    });
    try {
      expect(Number(store.getCell(0, 2)?.text)).toBe(30);
      expect(Number(store.getCell(1, 2)?.text)).toBe(6);
    } finally { unsubscribe(); }
  });

  it('undoing the anchor edit (SetCellText) leaves no orphan shadows', () => {
    const store = new Store();
    const engine = new FormulaEngine(store);
    const sync = createFormulaSync(store, engine);
    const cmd = new SetCellText({ r: 0, c: 0, text: '=SEQUENCE(3)' });
    cmd.execute(store);
    expect(store.getCell(2, 0)?.spillOf).toBeDefined();

    const undo = cmd.getUndo();
    undo.execute(store);
    expect(store.getCell(2, 0)).toBeUndefined();
    expect(store.getCell(0, 0)).toBeUndefined();
    sync.unsubscribe();
  });

  it('spill shadows survive a serialize/replaceAll round-trip', () => {
    const { store, unsubscribe } = setup((s) => { s.setCell(0, 0, { formula: '=SEQUENCE(3)', text: '' }); });
    try {
      const saved = store.serialize();
      const revived = new Store();
      const engine2 = new FormulaEngine(revived);
      const sync2 = createFormulaSync(revived, engine2);
      revived.replaceAll(saved);
      expect(revived.getCell(2, 0)?.spillOf).toBe(`${revived.getActiveSheetId()}:0,0`);
      expect(Number(revived.getCell(2, 0)?.text)).toBe(3);
      sync2.unsubscribe();
    } finally { unsubscribe(); }
  });

  it('XLOOKUP with a multi-column return array spills a row vector', () => {
    const { store, unsubscribe } = setup((s) => {
      s.setCell(0, 0, { text: 'a' }); s.setCell(1, 0, { text: 'b' });
      s.setCell(0, 1, { text: '10' }); s.setCell(0, 2, { text: 'x' });
      s.setCell(1, 1, { text: '20' }); s.setCell(1, 2, { text: 'y' });
      s.setCell(4, 0, { formula: '=XLOOKUP("b",A1:A2,B1:C2)', text: '' }); // E1
    });
    try {
      expect(store.getCell(4, 0)?.text).toBe('20');
      expect(store.getCell(4, 1)?.text).toBe('y');
      expect(store.getCell(4, 1)?.spillOf).toBe(`${store.getActiveSheetId()}:4,0`);
    } finally { unsubscribe(); }
  });

  it('a growing and shrinking spill rewrites the whole extent', () => {
    const { store, engine, unsubscribe } = setup((s) => { s.setCell(0, 0, { formula: '=SEQUENCE(4)', text: '' }); });
    try {
      expect(Number(store.getCell(3, 0)?.text)).toBe(4);
      engine.setFormula(cellId(0, 0), '=SEQUENCE(2)', formulaDependencies('=SEQUENCE(2)'));
      expect(Number(store.getCell(1, 0)?.text)).toBe(2);
      expect(store.getCell(2, 0)).toBeUndefined(); // retracted row
      expect(store.getCell(3, 0)).toBeUndefined();
    } finally { unsubscribe(); }
  });
});
