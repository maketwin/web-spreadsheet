import { describe, expect, it } from 'vitest';
import { CommandManager } from '../../src/commands/CommandManager';
import { DeleteColCommand } from '../../src/commands/impl/DeleteCol';
import { DeleteRowCommand } from '../../src/commands/impl/DeleteRow';
import { InsertColCommand } from '../../src/commands/impl/InsertCol';
import { InsertRowCommand } from '../../src/commands/impl/InsertRow';
import { FormulaEngine } from '../../src/formula/FormulaEngine';
import { createFormulaSync } from '../../src/formula/formulaSync';
import { Store } from '../../src/store/Store';

import type { Command } from '../../src/commands/Command';
import type { StoreEvent } from '../../src/types';

/** One cell's full observable state; `null` spillOf asserts the field is gone. */
interface SpillCellExpect { readonly formula?: string; readonly text?: string; readonly value?: unknown; readonly spillOf?: string | null; readonly absent?: boolean }

function expectSpillState(store: Store, sid: string, axis: 'row' | 'col', cells: ReadonlyArray<{ readonly at: number; readonly want: SpillCellExpect }>): void {
  for (const { at, want } of cells) {
    const r = axis === 'row' ? at : 0;
    const c = axis === 'row' ? 0 : at;
    const cell = store.getCell(r, c, sid);
    if (want.absent) {
      expect(cell ?? null, `cell at ${axis}${at} must be absent`).toBeNull();
      continue;
    }
    expect(cell === undefined, `cell at ${axis}${at} must exist`).toBe(false);
    if (want.formula !== undefined) expect(cell?.formula, `formula at ${axis}${at}`).toBe(want.formula);
    if (want.text !== undefined) expect(cell?.text, `text at ${axis}${at}`).toBe(want.text);
    if (want.value !== undefined) expect(cell?.value, `value at ${axis}${at}`).toBe(want.value);
    if (want.spillOf !== undefined) expect(cell?.spillOf ?? null, `spillOf at ${axis}${at}`).toBe(want.spillOf);
  }
}

/** The fixture every spill scenario below starts from: a SEQUENCE(4) spill
 * along `axis` (rows for 'row', one row across columns for 'col' — anchor +
 * three shadows), and a plain 99 one cell past the spill that can slide in as
 * a blocker when the spill shrinks. */
function spillFixture(store: Store, sid: string, axis: 'row' | 'col'): void {
  const set = (at: number, cell: { text: string; value?: number; formula?: string; spillOf?: string }): void => {
    const r = axis === 'row' ? at : 0;
    const c = axis === 'row' ? 0 : at;
    store.setCell(r, c, cell, sid);
  };
  set(0, { text: '1', value: 1, formula: axis === 'col' ? '=SEQUENCE(1,4)' : '=SEQUENCE(4)' });
  for (let k = 1; k <= 3; k += 1) set(k, { text: String(k + 1), value: k + 1, spillOf: `${sid}:0,0` });
  set(4, { text: '99', value: 99 });
}

/** The intact fixture state, along `axis`. */
function fullSpillState(axis: 'row' | 'col', sid: string): ReadonlyArray<{ readonly at: number; readonly want: SpillCellExpect }> {
  const anchor = `${sid}:0,0`;
  return [
    { at: 0, want: { formula: axis === 'col' ? '=SEQUENCE(1,4)' : '=SEQUENCE(4)', text: '1', value: 1 } },
    { at: 1, want: { text: '2', value: 2, spillOf: anchor } },
    { at: 2, want: { text: '3', value: 3, spillOf: anchor } },
    { at: 3, want: { text: '4', value: 4, spillOf: anchor } },
    { at: 4, want: { text: '99', value: 99 } },
  ];
}

/** A workbook wired the way the UI wires it: engine + sync + command bus. */
function open(): { store: Store; engine: FormulaEngine; cm: CommandManager; sid: string; events: StoreEvent[]; watch: () => () => void } {
  const store = new Store();
  const engine = new FormulaEngine(store);
  createFormulaSync(store, engine);
  const cm = new CommandManager(store);
  const sid = store.getActiveSheetId();
  const events: StoreEvent[] = [];
  const watch = (): (() => void) => store.subscribe((e) => events.push(e));
  return { store, engine, cm, sid, events, watch };
}

const run = (cm: CommandManager, cmd: Command): void => { cm.execute.bind(cm)(cmd); };

describe('formula sync across structural moves', () => {
  it('1a. a total outside the band follows inserts, deletes, undo and redo', () => {
    const s = open();
    for (let r = 0; r < 50; r += 1) s.store.setCell(r, 0, { text: String(r + 1), value: r + 1 }, s.sid);
    s.store.setCell(60, 4, { text: '=SUM(A1:A50)', formula: '=SUM(A1:A50)' }, s.sid); // E61
    expect(s.store.getCell(60, 4, s.sid)?.value).toBe(1275);
    s.watch();
    run(s.cm, new InsertRowCommand({ r: 10, count: 2 }));
    expect(s.store.getCell(62, 4, s.sid)?.value).toBe(1275); // total moved with its cell
    expect(s.store.getCell(62, 4, s.sid)?.formula).toBe('=SUM(A1:A52)');
    run(s.cm, new DeleteRowCommand({ r: 0, count: 3 })); // rows 1..3 (values 1,2,3) gone
    expect(s.store.getCell(59, 4, s.sid)?.value).toBe(1269);
    expect(s.store.getCell(59, 4, s.sid)?.formula).toBe('=SUM(A1:A49)');
    s.cm.undo(); // undo the delete: values 1,2,3 return
    expect(s.store.getCell(62, 4, s.sid)?.value).toBe(1275);
    s.cm.undo(); // undo the insert
    expect(s.store.getCell(60, 4, s.sid)?.value).toBe(1275);
    expect(s.store.getCell(60, 4, s.sid)?.formula).toBe('=SUM(A1:A50)');
    s.cm.redo(); // redo the insert
    expect(s.store.getCell(62, 4, s.sid)?.value).toBe(1275);
  });

  it('1b. a cross-sheet total follows formulas entered on the data sheet', () => {
    const s = open();
    const data = s.store.addSheet('Data1');
    for (let r = 1; r < 2000; r += 1) s.store.setCell(r, 4, { text: String(r), value: r }, data); // values 1..1999
    s.store.setCell(0, 0, { text: '=SUM(Data1!E2:E2000)', formula: '=SUM(Data1!E2:E2000)' }, s.sid);
    const expected = (1999 * 2000) / 2; // 1,999,000
    expect(s.store.getCell(0, 0, s.sid)?.value).toBe(expected);
    run(s.cm, new InsertRowCommand({ r: 0, sheetId: data })); // insert on Data1: the total sits on Summary and stays put
    expect(s.store.getCell(0, 0, s.sid)?.value).toBe(expected);
    expect(s.store.getCell(0, 0, s.sid)?.formula).toBe('=SUM(Data1!E3:E2001)');
    run(s.cm, new DeleteRowCommand({ r: 5, count: 1, sheetId: data })); // 0-based row 5 = value 4 (post-insert) leaves
    expect(s.store.getCell(0, 0, s.sid)?.value).toBe(expected - 4);
    s.cm.undo();
    expect(s.store.getCell(0, 0, s.sid)?.value).toBe(expected);
  });

  it('2. position-free references re-evaluate after a delete (INDEX(A:A,5), SUM(B2:B))', () => {
    const s = open();
    for (let r = 0; r < 20; r += 1) s.store.setCell(r, 0, { text: String((r + 1) * 10), value: (r + 1) * 10 }, s.sid);
    s.store.setCell(1, 1, { text: '7', value: 7 }, s.sid);
    s.store.setCell(2, 1, { text: '8', value: 8 }, s.sid);
    s.store.setCell(30, 4, { text: '=INDEX(A:A, 5)', formula: '=INDEX(A:A, 5)' }, s.sid);
    s.store.setCell(31, 4, { text: '=SUM(B2:B)', formula: '=SUM(B2:B)' }, s.sid);
    expect(s.store.getCell(30, 4, s.sid)?.value).toBe(50); // A5
    expect(s.store.getCell(31, 4, s.sid)?.value).toBe(15);
    run(s.cm, new DeleteRowCommand({ r: 0, count: 1 }));
    // Old row 6 (60) is now row 5: INDEX(A:A,5) follows the address, not the data.
    expect(s.store.getCell(29, 4, s.sid)?.value).toBe(60);
    expect(s.store.getCell(30, 4, s.sid)?.value).toBe(15); // B2:B still 7+8
    s.cm.undo();
    expect(s.store.getCell(30, 4, s.sid)?.value).toBe(50);
    expect(s.store.getCell(31, 4, s.sid)?.value).toBe(15);
  });

  it('3. shadows inside a moved band are re-spilled from the anchor: no residue, no #SPILL!', () => {
    const s = open();
    s.store.setCell(0, 0, { text: '=SEQUENCE(5)', formula: '=SEQUENCE(5)' }, s.sid);
    expect(s.store.getCell(0, 0, s.sid)?.value).toBe(1);
    for (let r = 1; r < 5; r += 1) expect(s.store.getCell(r, 0, s.sid)?.spillOf).toBe(`${s.sid}:0,0`);
    run(s.cm, new InsertRowCommand({ r: 2, count: 3 })); // shadows at rows 3,4 dropped; anchor re-spills rows 1..4
    for (let r = 1; r < 5; r += 1) {
      const cell = s.store.getCell(r, 0, s.sid);
      expect(cell?.spillOf).toBe(`${s.sid}:0,0`);
      expect(cell?.value).toBe(r + 1); // SEQUENCE(5) rows 1..4 → 2..5
    }
    expect(s.store.getCell(5, 0, s.sid)).toBeUndefined(); // moved shadows left no residue
    expect(s.store.getCell(0, 0, s.sid)?.text).not.toBe('#SPILL!');
    run(s.cm, new DeleteRowCommand({ r: 2, count: 3 }));
    for (let r = 1; r < 5; r += 1) expect(s.store.getCell(r, 0, s.sid)?.value).toBe(r + 1);
    expect(s.store.getCell(5, 0, s.sid)).toBeUndefined();
  });

  it('4. an anchor inside the band moves: new position holds values, old position empties', () => {
    const s = open();
    s.store.setCell(10, 2, { text: '=SEQUENCE(4)', formula: '=SEQUENCE(4)' }, s.sid);
    expect(s.store.getCell(10, 2, s.sid)?.value).toBe(1);
    expect(s.store.getCell(13, 2, s.sid)?.value).toBe(4);
    run(s.cm, new InsertRowCommand({ r: 0, count: 5 }));
    expect(s.store.getCell(15, 2, s.sid)?.value).toBe(1); // anchor at 10+5
    expect(s.store.getCell(18, 2, s.sid)?.value).toBe(4);
    expect(s.store.getCell(10, 2, s.sid)).toBeUndefined(); // old anchor position empty
    expect(s.store.getCell(13, 2, s.sid)).toBeUndefined(); // old shadows gone
    run(s.cm, new DeleteRowCommand({ r: 0, count: 5 }));
    expect(s.store.getCell(10, 2, s.sid)?.value).toBe(1);
    expect(s.store.getCell(13, 2, s.sid)?.value).toBe(4);
  });

  it('5. a whole-column rectangle dependency survives structural moves', () => {
    const s = open();
    for (let r = 0; r < 500; r += 1) s.store.setCell(r, 0, { text: String(r + 1), value: r + 1 }, s.sid);
    s.store.setCell(0, 3, { text: '=SUM(A:A)', formula: '=SUM(A:A)' }, s.sid);
    expect(s.store.getCell(0, 3, s.sid)?.value).toBe(125250);
    run(s.cm, new InsertRowCommand({ r: 0, count: 2 }));
    expect(s.store.getCell(2, 3, s.sid)?.value).toBe(125250);
    // The regression from the previous round: a change INSIDE the range after
    // the structural move must still wake the whole-column total. Original
    // value 251 now lives at row 252.
    s.store.setCell(252, 0, { text: '0', value: 0 }, s.sid);
    expect(s.store.getCell(2, 3, s.sid)?.value).toBe(124999);
    run(s.cm, new DeleteRowCommand({ r: 10, count: 1 })); // 0-based row 10 = Excel row 11 = value 9 (post-insert) leaves
    expect(s.store.getCell(2, 3, s.sid)?.value).toBe(124990); // the total sits at row 2, below the deleted row
    // Original value 500 now at 0-based row 500: change it, the total follows again.
    s.store.setCell(500, 0, { text: '0', value: 0 }, s.sid);
    expect(s.store.getCell(2, 3, s.sid)?.value).toBe(124490);
  });

  it('6. a batched structural insert delivers exactly one structure event; per-cell events only for rewrites', () => {
    const s = open();
    for (let r = 0; r < 100; r += 1) {
      s.store.setCell(r, 0, { text: String(r), value: r }, s.sid);
      s.store.setCell(r, 1, { text: `=A${r + 1}*2`, formula: `=A${r + 1}*2` }, s.sid);
    }
    s.watch();
    run(s.cm, new InsertRowCommand({ r: 0 }));
    const structure = s.events.filter((e) => e.type === 'structure');
    expect(structure).toHaveLength(1);
    const cellEvents = s.events.filter((e) => e.type === 'cell');
    expect(cellEvents.length).toBeLessThanOrEqual(100 + 10); // the 100 rewritten formulas, nothing else
    // The remounted formulas recalculated: the doubled values moved with them.
    expect(s.store.getCell(1, 1, s.sid)?.value).toBe(0); // =A1*2, A1 empty
    expect(s.store.getCell(100, 1, s.sid)?.value).toBe(198); // =A101*2, A101 = old A100 = 99
  });

  // ── Spill anchors × structural moves: every relative position, both axes ──

  describe('spill anchors vs structural moves (rows)', () => {
    const axis = 'row' as const;

    it('R1. deleting the anchor row clears anchor + all shadows; undo and redo restore/clear exactly', () => {
      const s = open();
      spillFixture(s.store, s.sid, axis);
      run(s.cm, new DeleteRowCommand({ r: 0 }));
      expectSpillState(s.store, s.sid, axis, [
        { at: 0, want: { absent: true } }, { at: 1, want: { absent: true } },
        { at: 2, want: { absent: true } },
        { at: 3, want: { text: '99', value: 99 } }, // the 99 slid up with the deleted row
        { at: 4, want: { absent: true } },
      ]);
      s.cm.undo();
      expectSpillState(s.store, s.sid, axis, fullSpillState(axis, s.sid));
      s.cm.redo();
      expectSpillState(s.store, s.sid, axis, [
        { at: 0, want: { absent: true } }, { at: 1, want: { absent: true } },
        { at: 2, want: { absent: true } },
        { at: 3, want: { text: '99', value: 99 } },
        { at: 4, want: { absent: true } },
      ]);
    });

    it('R2. deleting a band over the anchor and the first shadow clears everything below', () => {
      const s = open();
      spillFixture(s.store, s.sid, axis);
      run(s.cm, new DeleteRowCommand({ r: 0, count: 2 }));
      expectSpillState(s.store, s.sid, axis, [
        { at: 0, want: { absent: true } }, { at: 1, want: { absent: true } },
        { at: 2, want: { text: '99', value: 99 } }, // slid up: shadows refuse to travel
        { at: 3, want: { absent: true } }, { at: 4, want: { absent: true } },
      ]);
      s.cm.undo();
      expectSpillState(s.store, s.sid, axis, fullSpillState(axis, s.sid));
      s.cm.redo();
      expectSpillState(s.store, s.sid, axis, [
        { at: 0, want: { absent: true } }, { at: 1, want: { absent: true } },
        { at: 2, want: { text: '99', value: 99 } },
        { at: 3, want: { absent: true } }, { at: 4, want: { absent: true } },
      ]);
    });

    it('R3. deleting a middle shadow row blocks the spill; undo revives it', () => {
      const s = open();
      spillFixture(s.store, s.sid, axis);
      run(s.cm, new DeleteRowCommand({ r: 2, count: 1 }));
      // The 99 below slides into the extent and blocks: #SPILL! on the anchor,
      // in-extent shadows retired, the blocker stays.
      expectSpillState(s.store, s.sid, axis, [
        { at: 0, want: { text: '#SPILL!', value: '#SPILL!' } },
        { at: 1, want: { absent: true } },
        { at: 3, want: { text: '99', value: 99 } },
      ]);
      s.cm.undo();
      expectSpillState(s.store, s.sid, axis, fullSpillState(axis, s.sid));
      s.cm.redo();
      expectSpillState(s.store, s.sid, axis, [
        { at: 0, want: { text: '#SPILL!', value: '#SPILL!' } },
        { at: 1, want: { absent: true } },
        { at: 3, want: { text: '99', value: 99 } },
      ]);
    });

    it('R4. inserting above / right after the anchor / below the spill keeps the spill exact', () => {
      // Above: the whole spill shifts down with the anchor.
      let s = open();
      spillFixture(s.store, s.sid, axis);
      run(s.cm, new InsertRowCommand({ r: 0 }));
      expectSpillState(s.store, s.sid, axis, [
        { at: 0, want: { absent: true } },
        { at: 1, want: { formula: '=SEQUENCE(4)', text: '1', value: 1 } },
        { at: 2, want: { text: '2', value: 2, spillOf: `${s.sid}:1,0` } },
        { at: 3, want: { text: '3', value: 3, spillOf: `${s.sid}:1,0` } },
        { at: 4, want: { text: '4', value: 4, spillOf: `${s.sid}:1,0` } },
        { at: 5, want: { text: '99', value: 99 } },
      ]);
      s.cm.undo();
      expectSpillState(s.store, s.sid, axis, fullSpillState(axis, s.sid));

      // Right after the anchor row: in-extent shadows re-spill around the gap.
      s = open();
      spillFixture(s.store, s.sid, axis);
      run(s.cm, new InsertRowCommand({ r: 1 }));
      expectSpillState(s.store, s.sid, axis, [
        ...fullSpillState(axis, s.sid).slice(0, 4),
        { at: 4, want: { absent: true } },
        { at: 5, want: { text: '99', value: 99 } },
      ]);
      s.cm.undo();
      expectSpillState(s.store, s.sid, axis, fullSpillState(axis, s.sid));

      // Below the last shadow: the spill does not grow, the 99 slides down.
      s = open();
      spillFixture(s.store, s.sid, axis);
      run(s.cm, new InsertRowCommand({ r: 4 }));
      expectSpillState(s.store, s.sid, axis, [
        ...fullSpillState(axis, s.sid).slice(0, 4),
        { at: 4, want: { absent: true } },
        { at: 5, want: { text: '99', value: 99 } },
      ]);
      s.cm.undo();
      expectSpillState(s.store, s.sid, axis, fullSpillState(axis, s.sid));
    });
  });

  describe('spill anchors vs structural moves (columns)', () => {
    const axis = 'col' as const;

    it('C1. deleting the anchor column clears anchor + all shadows; undo and redo restore/clear exactly', () => {
      const s = open();
      spillFixture(s.store, s.sid, axis);
      run(s.cm, new DeleteColCommand({ c: 0 }));
      expectSpillState(s.store, s.sid, axis, [
        { at: 0, want: { absent: true } }, { at: 1, want: { absent: true } },
        { at: 2, want: { absent: true } },
        { at: 3, want: { text: '99', value: 99 } }, // the 99 slid left with the deleted column
        { at: 4, want: { absent: true } },
      ]);
      s.cm.undo();
      expectSpillState(s.store, s.sid, axis, fullSpillState(axis, s.sid));
      s.cm.redo();
      expectSpillState(s.store, s.sid, axis, [
        { at: 0, want: { absent: true } }, { at: 1, want: { absent: true } },
        { at: 2, want: { absent: true } },
        { at: 3, want: { text: '99', value: 99 } },
        { at: 4, want: { absent: true } },
      ]);
    });

    it('C2. deleting a band over the anchor and the first shadow clears everything right of it', () => {
      const s = open();
      spillFixture(s.store, s.sid, axis);
      run(s.cm, new DeleteColCommand({ c: 0, count: 2 }));
      expectSpillState(s.store, s.sid, axis, [
        { at: 0, want: { absent: true } }, { at: 1, want: { absent: true } },
        { at: 2, want: { text: '99', value: 99 } },
        { at: 3, want: { absent: true } }, { at: 4, want: { absent: true } },
      ]);
      s.cm.undo();
      expectSpillState(s.store, s.sid, axis, fullSpillState(axis, s.sid));
      s.cm.redo();
      expectSpillState(s.store, s.sid, axis, [
        { at: 0, want: { absent: true } }, { at: 1, want: { absent: true } },
        { at: 2, want: { text: '99', value: 99 } },
        { at: 3, want: { absent: true } }, { at: 4, want: { absent: true } },
      ]);
    });

    it('C3. deleting a middle shadow column blocks the spill; undo revives it', () => {
      const s = open();
      spillFixture(s.store, s.sid, axis);
      run(s.cm, new DeleteColCommand({ c: 2, count: 1 }));
      expectSpillState(s.store, s.sid, axis, [
        { at: 0, want: { text: '#SPILL!', value: '#SPILL!' } },
        { at: 1, want: { absent: true } },
        { at: 3, want: { text: '99', value: 99 } },
      ]);
      s.cm.undo();
      expectSpillState(s.store, s.sid, axis, fullSpillState(axis, s.sid));
      s.cm.redo();
      expectSpillState(s.store, s.sid, axis, [
        { at: 0, want: { text: '#SPILL!', value: '#SPILL!' } },
        { at: 1, want: { absent: true } },
        { at: 3, want: { text: '99', value: 99 } },
      ]);
    });

    it('C4. inserting left of / right after the anchor / right of the spill keeps the spill exact', () => {
      // Left of the anchor: the whole spill shifts right with the anchor.
      let s = open();
      spillFixture(s.store, s.sid, axis);
      run(s.cm, new InsertColCommand({ c: 0 }));
      expectSpillState(s.store, s.sid, axis, [
        { at: 0, want: { absent: true } },
        { at: 1, want: { formula: '=SEQUENCE(1,4)', text: '1', value: 1 } },
        { at: 2, want: { text: '2', value: 2, spillOf: `${s.sid}:0,1` } },
        { at: 3, want: { text: '3', value: 3, spillOf: `${s.sid}:0,1` } },
        { at: 4, want: { text: '4', value: 4, spillOf: `${s.sid}:0,1` } },
        { at: 5, want: { text: '99', value: 99 } },
      ]);
      s.cm.undo();
      expectSpillState(s.store, s.sid, axis, fullSpillState(axis, s.sid));

      // Right after the anchor column: in-extent shadows re-spill around the gap.
      s = open();
      spillFixture(s.store, s.sid, axis);
      run(s.cm, new InsertColCommand({ c: 1 }));
      expectSpillState(s.store, s.sid, axis, [
        ...fullSpillState(axis, s.sid).slice(0, 4),
        { at: 4, want: { absent: true } },
        { at: 5, want: { text: '99', value: 99 } },
      ]);
      s.cm.undo();
      expectSpillState(s.store, s.sid, axis, fullSpillState(axis, s.sid));

      // Right of the last shadow: the spill does not grow, the 99 slides right.
      s = open();
      spillFixture(s.store, s.sid, axis);
      run(s.cm, new InsertColCommand({ c: 4 }));
      expectSpillState(s.store, s.sid, axis, [
        ...fullSpillState(axis, s.sid).slice(0, 4),
        { at: 4, want: { absent: true } },
        { at: 5, want: { text: '99', value: 99 } },
      ]);
      s.cm.undo();
      expectSpillState(s.store, s.sid, axis, fullSpillState(axis, s.sid));
    });
  });
});
