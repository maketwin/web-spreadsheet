import { afterEach, describe, expect, it, vi } from 'vitest';
import { Store } from '../../src/store/Store';
import { TOTAL_ROWS } from '../../src/util/gridSize';
import { FilterService } from '../../src/filter/FilterService';

/**
 * Scale guards: filtering an entire-column selection must touch only the
 * stored rows (header + used region), never the 1,048,576-row address space.
 */

const ROWS = 200;
const COLS = 5;

function setupBlock(): Store {
  const store = new Store();
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const text = r === 0 ? `h${c}` : c === 1 && r % 2 === 0 ? '销售' : '研发';
      store.setCell(r, c, r === 0 ? { text } : { text, value: r * COLS + c, type: 'number' });
    }
  }
  return store;
}

const wholeColumn = (c1: number, c2: number) => ({ r1: 0, c1, r2: TOTAL_ROWS - 1, c2 });

describe('filter at grid scale', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('an entire-column selection infers header + used rows as the filter range', () => {
    const svc = new FilterService(setupBlock());
    expect(svc.autoFilterRangeFor(wholeColumn(1, 1))).toEqual({ r1: 0, c1: 1, r2: ROWS - 1, c2: 1 });
  });

  it('an entire-column multi-column selection keeps the selected columns', () => {
    const svc = new FilterService(setupBlock());
    expect(svc.autoFilterRangeFor(wholeColumn(1, 3))).toEqual({ r1: 0, c1: 1, r2: ROWS - 1, c2: 3 });
  });

  it('an empty entire-column selection falls back to a single header cell', () => {
    const svc = new FilterService(setupBlock());
    expect(svc.autoFilterRangeFor(wholeColumn(9, 9))).toEqual({ r1: 0, c1: 9, r2: 0, c2: 9 });
  });

  it('setting and applying a column filter visits only stored rows', () => {
    const store = setupBlock();
    const svc = new FilterService(store);
    // The UI path: toggleAutoFilter infers the range for the selection first.
    svc.setAutoFilter(svc.autoFilterRangeFor(wholeColumn(0, COLS - 1)));
    expect(store.getAutoFilter()?.range).toEqual({ r1: 0, c1: 0, r2: ROWS - 1, c2: COLS - 1 });
    const spy = vi.spyOn(Store.prototype, 'getCell');
    spy.mockClear();
    svc.setColumnFilter(1, { selected: ['销售'], includeBlanks: false });
    expect(spy.mock.calls.length).toBeLessThan(ROWS * COLS);
    // Even rows (r % 2 === 0, r >= 2) hold 销售 in column 1 and stay visible.
    expect(store.getRow(2)?.hide).toBe(false);
    expect(store.getRow(3)?.hide).toBe(true);
    expect(store.getRow(1)?.hide).toBe(true);
    expect(store.getRow(ROWS - 1)?.hide).toBe(true);
  });

  it('clearing filters unhides only rows that carry metadata', () => {
    const store = setupBlock();
    const svc = new FilterService(store);
    svc.setAutoFilter(svc.autoFilterRangeFor(wholeColumn(0, COLS - 1)));
    svc.setColumnFilter(1, { selected: ['销售'], includeBlanks: false });
    const setRowSpy = vi.spyOn(Store.prototype, 'setRow');
    svc.clearFilters();
    const rowEvents = setRowSpy.mock.calls.filter(([r]) => typeof r === 'number');
    expect(rowEvents.length).toBeLessThanOrEqual(ROWS);
    expect(store.getRow(3)?.hide).toBe(false);
  });

  it('getFilterItems walks only stored rows of an entire-column filter', () => {
    const store = setupBlock();
    const svc = new FilterService(store);
    svc.setAutoFilter(svc.autoFilterRangeFor(wholeColumn(1, 1)));
    const spy = vi.spyOn(Store.prototype, 'getCell');
    spy.mockClear();
    const items = svc.getFilterItems(1);
    expect(spy.mock.calls.length).toBeLessThan(ROWS * COLS);
    expect(items.map((item) => item.text).sort()).toEqual(['研发', '销售']);
    expect(items.find((item) => item.text === '销售')?.count).toBe(ROWS / 2 - 1);
    expect(items.find((item) => item.text === '研发')?.count).toBe(ROWS / 2);
  });

  it('inferDataRegion on a single cell in a large sparse column stays bounded', () => {
    const store = new Store();
    store.setCell(999_000, 3, { text: 'deep' });
    store.setCell(999_001, 3, { text: 'deeper' });
    const spy = vi.spyOn(Store.prototype, 'getCell');
    const svc = new FilterService(store);
    const region = svc.inferDataRegion({ r1: 999_000, c1: 3, r2: 999_000, c2: 3 });
    expect(region).toEqual({ r1: 999_000, c1: 3, r2: 999_001, c2: 3 });
    expect(spy.mock.calls.length).toBeLessThan(500);
  });
});
