import { describe, expect, it } from 'vitest';
import { Store } from '../../src/store/Store';
import { CommandManager } from '../../src/commands/CommandManager';
import { ClearCellsCommand } from '../../src/commands/rangeValues';
import { FormulaEngine } from '../../src/formula/FormulaEngine';
import { createFormulaSync } from '../../src/formula/formulaSync';

/**
 * A wholesale rewrite of cells arrives as one `cells` event. Small batches
 * are answered per key, bigger ones (more than 256 keys) by the batch's
 * bounding rectangle — both must leave the engine in exactly the same state:
 * readers of anything inside recalculate, formulas inside re-sync, and the
 * undo that puts the cells back does the same in reverse.
 */
const KEYS_BELOW_LIMIT = 150;
const KEYS_ABOVE_LIMIT = 300;

function setup(): { store: Store; engine: FormulaEngine; cm: CommandManager; sid: string; off: () => void } {
  const store = new Store();
  const engine = new FormulaEngine(store);
  const sync = createFormulaSync(store, engine);
  return { store, engine, cm: new CommandManager(store), sid: store.getActiveSheetId(), off: () => sync.unsubscribe() };
}

function fill(store: Store, sid: string, rows: number): void {
  store.batch(() => {
    for (let r = 0; r < rows; r += 1) store.setCell(r, 0, { text: String(r + 1), value: r + 1 }, sid);
  });
}

describe.each([['per-key route', KEYS_BELOW_LIMIT], ['rectangle route', KEYS_ABOVE_LIMIT]] as const)('cells event, %s', (_route, rows) => {
  it('readers of the cleared cells recalculate: per-cell range, whole column, INDEX, single cell, cross-sheet', () => {
    const { store, cm, sid, off } = setup();
    fill(store, sid, rows);
    store.setCell(0, 2, { text: 'x', formula: `=SUM(A1:A${rows})` }, sid);
    store.setCell(1, 2, { text: 'x', formula: '=SUM(A:A)' }, sid);
    store.setCell(2, 2, { text: 'x', formula: '=INDEX(A:A, 5)' }, sid);
    store.setCell(3, 2, { text: 'x', formula: '=A10' }, sid);
    const other = store.addSheet('Other');
    store.setCell(0, 0, { text: 'x', formula: '=SUM(Sheet1!A1:A20)' }, other);
    const total = (rows * (rows + 1)) / 2;
    const first20 = (20 * 21) / 2;
    const read = (): unknown[] => [
      store.getCell(0, 2, sid)?.value, store.getCell(1, 2, sid)?.value, store.getCell(2, 2, sid)?.value,
      store.getCell(3, 2, sid)?.value, store.getCell(0, 0, other)?.value,
    ];
    expect(read()).toEqual([total, total, 5, 10, first20]);

    // Clear the first half of the column through the sparse clear command
    // (naming the sheet: adding "Other" made it the active one).
    const half = Math.floor(rows / 2);
    cm.execute.bind(cm)(new ClearCellsCommand({ rect: { r1: 0, c1: 0, r2: half - 1, c2: 0 }, sheetId: sid }));
    const rest = total - (half * (half + 1)) / 2;
    expect(store.getCell(half - 1, 0, sid)).toBeUndefined();
    expect(store.getCell(half, 0, sid)?.value).toBe(half + 1);
    // INDEX and the bare reference read a cleared cell: null, not 0.
    expect(read()).toEqual([rest, rest, null, null, first20 - (Math.min(20, half) * (Math.min(20, half) + 1)) / 2]);

    // The undo puts the cells back with one cells event of the same size.
    cm.undo();
    expect(read()).toEqual([total, total, 5, 10, first20]);
    off();
  });

  it('a formula inside the cleared rectangle unregisters — a plain value typed there afterwards is not overwritten', () => {
    const { store, cm, sid, off } = setup();
    fill(store, sid, rows);
    store.setCell(3, 0, { text: 'x', formula: '=B1*2' }, sid);
    store.setCell(0, 1, { text: '3', value: 3 }, sid);
    store.setCell(0, 2, { text: 'x', formula: '=A4' }, sid);
    expect([store.getCell(3, 0, sid)?.value, store.getCell(0, 2, sid)?.value]).toEqual([6, 6]);

    cm.execute.bind(cm)(new ClearCellsCommand({ rect: { r1: 0, c1: 0, r2: rows - 1, c2: 0 } }));
    expect(store.getCell(3, 0, sid)).toBeUndefined();
    expect(store.getCell(0, 2, sid)?.value).toBeNull();

    store.setCell(3, 0, { text: '5', value: 5 }, sid);
    expect([store.getCell(3, 0, sid)?.value, store.getCell(3, 0, sid)?.formula, store.getCell(0, 2, sid)?.value]).toEqual([5, undefined, 5]);

    // Undo: the formula cell comes back and calculates again.
    cm.undo();
    expect([store.getCell(3, 0, sid)?.formula, store.getCell(3, 0, sid)?.value, store.getCell(0, 2, sid)?.value]).toEqual(['=B1*2', 6, 6]);
    off();
  });

  it('a spill whose shadows were cleared re-spreads; clearing the anchor retires the whole spill', () => {
    const { store, cm, sid, off } = setup();
    fill(store, sid, rows);
    store.setCell(0, 5, { text: 'x', formula: '=SEQUENCE(4)' }, sid);
    const column = (): unknown[] => [0, 1, 2, 3].map((r) => store.getCell(r, 5, sid)?.value ?? null);
    expect(column()).toEqual([1, 2, 3, 4]);

    // Clear the three shadows together with the filler cells of column A
    // (so the batch crosses the per-key threshold on the rectangle route);
    // the anchor on row 1 survives.
    cm.execute.bind(cm)(new ClearCellsCommand({ rect: { r1: 1, c1: 0, r2: rows - 1, c2: 5 } }));
    expect(store.getCell(1, 0, sid)).toBeUndefined();
    expect(column()).toEqual([1, 2, 3, 4]);

    cm.undo();
    expect(store.getCell(1, 0, sid)?.value).toBe(2);
    expect(column()).toEqual([1, 2, 3, 4]);
    cm.redo();
    expect(column()).toEqual([1, 2, 3, 4]);
    cm.undo();

    // The anchor itself cleared: nothing of the spill survives, and a plain
    // value typed at the anchor stays.
    cm.execute.bind(cm)(new ClearCellsCommand({ rect: { r1: 0, c1: 5, r2: 3, c2: 5 } }));
    expect(column()).toEqual([null, null, null, null]);
    store.setCell(0, 5, { text: '7', value: 7 }, sid);
    expect(column()).toEqual([7, null, null, null]);
    off();
  });
});
