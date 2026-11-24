import { describe, expect, it, vi } from 'vitest';
import { CommandManager } from '../../src/commands/CommandManager';
import type { Command } from '../../src/commands/Command';
import { DeleteColCommand } from '../../src/commands/impl/DeleteCol';
import { DeleteRowCommand } from '../../src/commands/impl/DeleteRow';
import { FillRangeCommand } from '../../src/commands/impl/FillRange';
import { InsertColCommand } from '../../src/commands/impl/InsertCol';
import { InsertRowCommand } from '../../src/commands/impl/InsertRow';
import { RemoveDuplicatesCommand } from '../../src/commands/impl/RemoveDuplicates';
import { captureSheet, type SheetSnapshot } from '../../src/commands/impl/sheetSnapshot';
import { Store } from '../../src/store/Store';
import { TOTAL_COLS, TOTAL_ROWS } from '../../src/util/gridSize';

import type { Cell } from '../../src/types';

/** Comparable whole-workbook state: cell content (incl. spill shadows), row/col
 * meta, merges, row groups, floating objects, structures. Structural undo must
 * bring the store back to exactly this. */
function stateOf(store: Store): Record<string, unknown> {
  const cells: Record<string, Partial<Cell>> = {};
  const rows: Array<[string, number, number | undefined, boolean | undefined]> = [];
  const cols: Array<[string, number, number | undefined, boolean | undefined]> = [];
  for (const { id } of store.getSheets()) {
    for (const [key, cell] of store.getCells(id)) {
      const flat: Partial<Cell> = { text: cell.text };
      if (cell.value !== undefined) flat.value = cell.value;
      if (cell.spillOf !== undefined) flat.spillOf = cell.spillOf;
      if (cell.styleId !== undefined) flat.styleId = cell.styleId;
      if (cell.formula !== undefined) flat.formula = cell.formula;
      cells[`${id}:${key}`] = flat;
    }
    for (let r = 0; r < TOTAL_ROWS; r += 1) {
      const meta = store.getRow(r, id);
      if (meta !== undefined) rows.push([id, r, meta.height, meta.hide]);
    }
    for (let c = 0; c < TOTAL_COLS; c += 1) {
      const meta = store.getCol(c, id);
      if (meta !== undefined) cols.push([id, c, meta.width, meta.hide]);
    }
  }
  const perSheet = <T>(pick: (store: Store, id: string) => readonly T[]): Array<[string, ...T[]]> =>
    store.getSheets().map(({ id }) => [id, ...pick(store, id)] as [string, ...T[]]);
  return {
    cells,
    rows,
    cols,
    merges: perSheet((s, id) => [...s.getMerges(id)].sort()),
    rowGroups: perSheet((s, id) => [...s.getRowGroups(id)]),
    charts: perSheet((s, id) => s.getCharts(id).map((ch) => ({ id: ch.id, range: ch.range, anchor: ch.anchor }))),
    images: perSheet((s, id) => s.getImages(id).map((im) => ({ id: im.id, anchor: im.anchor }))),
    sparklines: perSheet((s, id) => s.getSparklines(id).map((sp) => ({ ...sp }))),
    namedRanges: perSheet((s, id) => [...s.getNamedRanges(id)]),
    conditionalRules: perSheet((s, id) => [...s.getConditionalRules(id)]),
    validationRules: perSheet((s, id) => [...s.getValidationRules(id)]),
    autoFilters: store.getSheets().map(({ id }) => [id, store.getAutoFilter(id)] as const),
  };
}

/** A sheet with content around every feature a structural edit can move. */
function richStore(): Store {
  const store = new Store();
  const sid = store.getActiveSheetId();
  for (let r = 0; r < 20; r += 1) {
    store.setCell(r, 0, { text: `a${r}`, value: r }, sid);
    store.setCell(r, 1, { text: `b${r}`, value: r * 2 }, sid);
  }
  store.setCell(999, 1, { text: 'last', value: 999 }, sid); // grid-edge row
  store.setCell(4, 25, { text: 'edge', value: 25 }, sid); // grid-edge column
  store.setCell(5, 2, { text: '', formula: '=B6' }, sid); // same-sheet formula
  store.setRow(7, { height: 44 }, sid);
  store.setRow(9, { height: 30, hide: true }, sid);
  store.setCol(3, { width: 120 }, sid);
  store.addMerge('10,0:11,1', sid);
  store.setRowGroups([{ start: 12, end: 14 }], sid);
  store.addChart({ id: 'chart-1', type: 'line', range: '0,0:9,1', anchor: { from: { r: 2, c: 4, offX: 3, offY: 4 }, to: { r: 8, c: 7, offX: 5, offY: 6 } } }, sid);
  store.addImage({ id: 'img-1', name: 'pic', src: 'data:image/png;base64,x', anchor: { from: { r: 3, c: 5, offX: 1, offY: 2 }, to: { r: 6, c: 8, offX: 3, offY: 4 } } }, sid);
  store.addSparkline({ id: 'spark-1', type: 'line', range: '0,0:4,1', row: 6, col: 5 }, sid);
  store.setNamedRange('Data', { range: '0,0:9,1' }, sid);
  store.setConditionalRule('1,0:5,1', [{ type: 'dataBar', min: 0, max: 100, color: '#4A90D9' }], sid);
  store.setValidationRule('2,0', { type: 'list', values: ['a', 'b'] }, sid);
  const sheet2 = store.addSheet('Sheet2');
  store.setCell(0, 0, { text: 'plain' }, sheet2); // non-formula: never touched by structural edits
  store.setCell(1, 0, { text: '', formula: '=Sheet1!B6' }, sheet2);
  store.activateSheet(sid);
  return store;
}

describe('structural band undo fidelity', () => {
  const cases: Array<[string, (at: number) => Command]> = [
    ['InsertRow', (r) => new InsertRowCommand({ r })],
    ['DeleteRow', (r) => new DeleteRowCommand({ r })],
    ['InsertCol', (c) => new InsertColCommand({ c })],
    ['DeleteCol', (c) => new DeleteColCommand({ c })],
  ];
  const ats = [0, 6, 10, 500, 999]; // top / middle of the data / deep / grid edge
  const colAts = [0, 2, 3, 25]; // col 3 carries width meta, col 25 the edge cell

  for (const [name, make] of cases) {
    for (const at of name.endsWith('Row') ? ats : colAts) {
      it(`${name} at ${at}: undo restores the sheet, redo replays it`, () => {
        const store = richStore();
        const before = stateOf(store);
        const cmd = make(at);
        cmd.execute(store);
        const afterExec = stateOf(store);
        expect(afterExec).not.toEqual(before); // the command actually did something
        cmd.getUndo().execute(store);
        expect(stateOf(store)).toEqual(before);
        cmd.execute(store); // CommandManager redo re-runs the original command
        expect(stateOf(store)).toEqual(afterExec);
      });
    }
  }

  it('InsertRow below uses the shifted band start (r+1)', () => {
    const store = richStore();
    const before = stateOf(store);
    const cmd = new InsertRowCommand({ r: 6, position: 'below' });
    cmd.execute(store);
    const afterExec = stateOf(store);
    expect(afterExec).not.toEqual(before);
    cmd.getUndo().execute(store);
    expect(stateOf(store)).toEqual(before);
    cmd.execute(store); // redo
    expect(stateOf(store)).toEqual(afterExec);
  });

  it('a mid-sheet insert snapshots only the band (at most half the cells, all in-band)', () => {
    const store = new Store();
    for (let r = 0; r < TOTAL_ROWS; r += 1) {
      for (let c = 0; c < TOTAL_COLS; c += 1) store.setCell(r, c, { text: 'v', value: 1 });
    }
    const cmd = new InsertRowCommand({ r: 500 });
    cmd.execute(store);
    const snap = (cmd as unknown as { oldSheet: SheetSnapshot }).oldSheet;
    expect(snap.band).toEqual({ axis: 'row', from: 500 });
    expect(snap.cells.length).toBeLessThanOrEqual((TOTAL_ROWS * TOTAL_COLS) / 2);
    expect(snap.cells.every(([r]) => r >= 500)).toBe(true);
    cmd.getUndo().execute(store);
    expect(store.getCells()).toHaveLength(TOTAL_ROWS * TOTAL_COLS);
  });

  it('undo resets row metadata only inside the band (no setRow above it)', () => {
    const store = richStore();
    const cmd = new InsertRowCommand({ r: 500 });
    cmd.execute(store);
    const spy = vi.spyOn(store, 'setRow');
    cmd.getUndo().execute(store);
    const touched = spy.mock.calls.map(([r]) => r);
    expect(touched.length).toBeGreaterThan(0);
    expect(touched.every((r) => r >= 500)).toBe(true);
    vi.restoreAllMocks();
  });

  it('undo restores a formula sitting above the band whose reference moved', () => {
    const store = new Store();
    const sid = store.getActiveSheetId();
    store.setCell(0, 0, { text: '', formula: '=A600' }, sid);
    store.setCell(600, 0, { text: 'x', value: 'x' }, sid);
    const before = stateOf(store);
    const cmd = new InsertRowCommand({ r: 500 });
    cmd.execute(store);
    expect(store.getCell(0, 0, sid)?.formula).toBe('=A601'); // rewritten in place, above the band
    cmd.getUndo().execute(store);
    expect(stateOf(store)).toEqual(before);
  });

  it('undo restores spill shadows and the anchor across a band boundary', () => {
    const store = new Store();
    const sid = store.getActiveSheetId();
    store.setCell(498, 0, { text: '1', value: 1, formula: '=A700' }, sid);
    store.setCell(499, 0, { text: '1', value: 1, spillOf: `${sid}:498,0` }, sid);
    store.setCell(500, 0, { text: '1', value: 1, spillOf: `${sid}:498,0` }, sid);
    const before = stateOf(store);
    const cmd = new InsertRowCommand({ r: 500 });
    cmd.execute(store);
    cmd.getUndo().execute(store);
    expect(stateOf(store)).toEqual(before);
  });

  it('undo restores cross-sheet formulas without wiping other sheets\' plain cells', () => {
    const store = new Store();
    const s1 = store.getActiveSheetId();
    store.setCell(600, 0, { text: 'x', value: 'x' }, s1);
    const s2 = store.addSheet('Sheet2');
    store.setCell(3, 3, { text: 'plain' }, s2);
    store.setCell(4, 4, { text: '', formula: '=Sheet1!A601' }, s2);
    store.activateSheet(s1);
    const before = stateOf(store);
    const cmd = new InsertRowCommand({ r: 500 });
    cmd.execute(store);
    expect(store.getCell(4, 4, s2)?.formula).toBe('=Sheet1!A602');
    cmd.getUndo().execute(store);
    expect(stateOf(store)).toEqual(before);
  });

  it('snapshots store cells by reference (no clones)', () => {
    const store = new Store();
    const sid = store.getActiveSheetId();
    store.setCell(5, 5, { text: 'ref' }, sid);
    const snap = captureSheet(store, sid, { axis: 'row', from: 0 });
    const [, , cell] = snap.cells.find(([r, c]) => r === 5 && c === 5)!;
    expect(cell).toBe(store.getCell(5, 5, sid)); // same object, not a copy
  });
});

describe('RemoveDuplicates undo is unaffected', () => {
  it('undo restores the full sheet including floating objects', () => {
    const store = new Store();
    const sid = store.getActiveSheetId();
    for (let r = 0; r < 6; r += 1) {
      const dup = r === 2 || r === 5;
      store.setCell(r, 0, { text: dup ? 'dup' : `row${r}` }, sid);
    }
    store.addMerge('1,0:1,1', sid);
    store.addImage({ id: 'img-1', name: 'pic', src: 'data:image/png;base64,x', anchor: { from: { r: 3, c: 4, offX: 0, offY: 0 }, to: { r: 4, c: 6, offX: 2, offY: 3 } } }, sid);
    store.addSparkline({ id: 'spark-1', type: 'bar', range: '0,0:5,0', row: 0, col: 3 }, sid);
    const before = stateOf(store);
    const cmd = new RemoveDuplicatesCommand({ r1: 0, c1: 0, r2: 5, c2: 0, columns: [0], hasHeader: false });
    cmd.execute(store);
    expect(cmd.removedCount()).toBe(1); // first occurrence (row 2) kept, row 5 deleted
    expect(stateOf(store)).not.toEqual(before);
    cmd.getUndo().execute(store);
    expect(stateOf(store)).toEqual(before);
    cmd.execute(store); // redo
    expect(cmd.removedCount()).toBe(1);
    expect(stateOf(store)).not.toEqual(before);
  });
});

describe('RestoreFillRange is undoable itself', () => {
  it('undoing a fill can be undone again (re-runs the fill)', () => {
    const store = new Store();
    store.setCell(0, 0, { text: '1' });
    const fill = new FillRangeCommand({ source: { r1: 0, c1: 0, r2: 0, c2: 0 }, target: { r1: 0, c1: 0, r2: 2, c2: 0 } });
    fill.execute(store);
    expect(store.getCell(2, 0)?.text).toBe('1');

    const restore = fill.getUndo();
    const restoreUndo = restore.getUndo(); // used to throw
    restore.execute(store);
    expect(store.getCell(2, 0)).toBeUndefined();
    restoreUndo.execute(store);
    expect(store.getCell(2, 0)?.text).toBe('1');
  });

  it('CommandManager undo/redo round-trips a fill', () => {
    const store = new Store();
    store.setCell(0, 0, { text: '1' });
    const cm = new CommandManager(store);
    cm.execute(new FillRangeCommand({ source: { r1: 0, c1: 0, r2: 0, c2: 0 }, target: { r1: 0, c1: 0, r2: 2, c2: 0 } }));
    expect(store.getCell(2, 0)?.text).toBe('1');
    cm.undo();
    expect(store.getCell(2, 0)).toBeUndefined();
    cm.redo();
    expect(store.getCell(2, 0)?.text).toBe('1');
    expect(store.getCell(1, 0)?.text).toBe('1');
  });
});
