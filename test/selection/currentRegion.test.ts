import { describe, expect, it } from 'vitest';
import { Store } from '../../src/store/Store';
import { currentRegion, excelSelectAll } from '../../src/selection/currentRegion';
import { cellSelection, rangeSelection, sheetSelection } from '../../src/selection/Selection';

const ROWS = 100;
const COLS = 26;

function storeWith(cells: [number, number, string][]): Store {
  const store = new Store();
  for (const [r, c, text] of cells) store.setCell(r, c, { text });
  return store;
}

describe('currentRegion', () => {
  it('returns the bounding box of the connected data block', () => {
    const store = storeWith([[1, 1, 'a'], [1, 2, 'b'], [2, 1, 'c'], [2, 2, 'd'], [5, 5, 'far']]);
    expect(currentRegion(store, { r: 2, c: 2 }, ROWS, COLS)).toEqual({ r1: 1, c1: 1, r2: 2, c2: 2 });
  });

  it('an empty start cell adjacent to data still selects the block', () => {
    const store = storeWith([[1, 1, 'a'], [2, 1, 'b']]);
    expect(currentRegion(store, { r: 3, c: 1 }, ROWS, COLS)).toEqual({ r1: 1, c1: 1, r2: 2, c2: 1 });
  });

  it('does not cross blank rows or columns', () => {
    const store = storeWith([[0, 0, 'a'], [0, 2, 'gap-col'], [2, 0, 'gap-row']]);
    expect(currentRegion(store, { r: 0, c: 0 }, ROWS, COLS)).toEqual({ r1: 0, c1: 0, r2: 0, c2: 0 });
  });

  it('does not connect diagonally (Excel semantics)', () => {
    const store = storeWith([[0, 0, 'a'], [1, 1, 'diag']]);
    expect(currentRegion(store, { r: 0, c: 0 }, ROWS, COLS)).toEqual({ r1: 0, c1: 0, r2: 0, c2: 0 });
  });

  it('counts formula cells as content and ignores blank-styled cells', () => {
    const store = storeWith([[0, 0, 'a']]);
    store.setCell(0, 1, { text: '', styleId: 's1' });
    store.setCell(1, 0, { text: 'x', formula: '=1+1' });
    expect(currentRegion(store, { r: 0, c: 0 }, ROWS, COLS)).toEqual({ r1: 0, c1: 0, r2: 1, c2: 0 });
  });

  it('returns undefined for an isolated empty cell', () => {
    const store = storeWith([[10, 10, 'far']]);
    expect(currentRegion(store, { r: 0, c: 0 }, ROWS, COLS)).toBeUndefined();
  });
});

describe('excelSelectAll', () => {
  const whole = { r1: 0, c1: 0, r2: ROWS - 1, c2: COLS - 1 };

  it('first Ctrl+A selects the current region around the active cell', () => {
    const store = storeWith([[1, 1, 'a'], [1, 2, 'b'], [2, 2, 'c']]);
    const sel = excelSelectAll(store, cellSelection(2, 2), ROWS, COLS);
    expect(sel.kind).toBe('range');
    expect(sel.range).toEqual({ r1: 1, c1: 1, r2: 2, c2: 2 });
    // Active cell stays where the user was.
    expect(sel.active).toEqual({ r: 2, c: 2 });
  });

  it('second Ctrl+A on the region selects the whole sheet', () => {
    const store = storeWith([[1, 1, 'a'], [1, 2, 'b'], [2, 2, 'c']]);
    const regionSel = rangeSelection({ r1: 1, c1: 1, r2: 2, c2: 2 }, { r: 2, c: 2 }, { r: 2, c: 2 });
    const sel = excelSelectAll(store, regionSel, ROWS, COLS);
    expect(sel.kind).toBe('sheet');
    expect(sel.range).toEqual(whole);
  });

  it('selects the whole sheet immediately when the active cell is isolated', () => {
    const store = storeWith([[10, 10, 'far']]);
    const sel = excelSelectAll(store, cellSelection(0, 0), ROWS, COLS);
    expect(sel.kind).toBe('sheet');
    expect(sel.range).toEqual(whole);
  });

  it('keeps the whole-sheet selection on repeated Ctrl+A', () => {
    const store = storeWith([[1, 1, 'a']]);
    const sel = excelSelectAll(store, sheetSelection(whole), ROWS, COLS);
    expect(sel.kind).toBe('sheet');
  });

  it('with no selection, selects the whole sheet', () => {
    const store = storeWith([[1, 1, 'a']]);
    expect(excelSelectAll(store, null, ROWS, COLS).kind).toBe('sheet');
  });
});
