import { describe, expect, it } from 'vitest';
import { paginate, usedRange } from '../../src/print/PrintPaginator';
import { DEFAULT_PRINT_SETTINGS, contentPx, type PrintSettings } from '../../src/print/types';
import { Store } from '../../src/store/Store';

function settings(overrides: Partial<PrintSettings> = {}): PrintSettings {
  return { ...DEFAULT_PRINT_SETTINGS, margin: 'narrow', scaleMode: 'custom', scalePercent: 100, ...overrides };
}

/** A4 portrait, narrow margins → content ≈ 745.7 × 1074.5 CSS px. */
const CONTENT = contentPx(settings());

function makeStore(): Store {
  return new Store();
}

describe('usedRange', () => {
  it('empty sheet falls back to A1', () => {
    expect(usedRange(makeStore())).toEqual({ r1: 0, c1: 0, r2: 0, c2: 0 });
  });

  it('tracks the bottom-right cell with content', () => {
    const store = makeStore();
    store.setCell(3, 1, { text: 'a' });
    store.setCell(7, 4, { text: 'b' });
    store.setCell(2, 0, { text: '' }); // empty text does not count
    expect(usedRange(store)).toEqual({ r1: 0, c1: 0, r2: 7, c2: 4 });
  });

  it('counts formulas and styled-but-empty cells', () => {
    const store = makeStore();
    store.setCell(5, 2, { text: '=SUM(A1:A2)', formula: '=SUM(A1:A2)' });
    store.setCell(1, 8, { text: '', styleId: 's1' });
    expect(usedRange(store)).toEqual({ r1: 0, c1: 0, r2: 5, c2: 8 });
  });

  it('extends over merges reaching beyond the last cell', () => {
    const store = makeStore();
    store.setCell(0, 0, { text: 'x' });
    store.addMerge('B2:C9');
    expect(usedRange(store)).toEqual({ r1: 0, c1: 0, r2: 8, c2: 2 });
  });
});

describe('paginate', () => {
  it('splits column bands that overflow the content width', () => {
    const store = makeStore();
    store.setCell(0, 2, { text: 'x' });
    store.setCol(0, { width: 300 });
    store.setCol(1, { width: 300 });
    store.setCol(2, { width: 300 });
    const geo = paginate(store, store.getActiveSheetId(), usedRange(store), settings());
    // 300+300 fits, adding the third column overflows → cut before col 2.
    expect(geo.colBands).toEqual([{ start: 0, end: 1 }, { start: 2, end: 2 }]);
    expect(geo.pages).toHaveLength(2);
  });

  it('splits row bands and orders pages down-then-across (Excel order)', () => {
    const store = makeStore();
    store.setCell(60, 0, { text: 'x' });
    store.setCell(60, 1, { text: 'y' });
    store.setCol(0, { width: 300 });
    store.setCol(1, { width: 300 });
    const geo = paginate(store, store.getActiveSheetId(), usedRange(store), settings());
    expect(geo.rowBands).toEqual([{ start: 0, end: 52 }, { start: 53, end: 60 }]);
    expect(geo.pages.map((p) => [p.colStart, p.colEnd, p.rowStart, p.rowEnd])).toEqual([
      [0, 1, 0, 52],
      [0, 1, 53, 60],
    ]);
  });

  it('does not cut a merge that could start its own band', () => {
    const store = makeStore();
    store.setCell(1, 2, { text: 'x' });
    store.setCol(0, { width: 300 });
    store.setCol(1, { width: 300 });
    store.setCol(2, { width: 300 });
    store.addMerge('B1:C2'); // spans cols 1–2, right where the cut would fall
    const geo = paginate(store, store.getActiveSheetId(), usedRange(store), settings());
    expect(geo.colBands).toEqual([{ start: 0, end: 0 }, { start: 1, end: 2 }]);
  });

  it('keeps a merge whole even when it starts the band and overflows', () => {
    const store = makeStore();
    store.setCell(0, 0, { text: 'x' });
    store.setCol(0, { width: 400 });
    store.setCol(1, { width: 400 });
    store.setCol(2, { width: 400 });
    store.addMerge('A1:C1'); // wider than the page content width
    const geo = paginate(store, store.getActiveSheetId(), usedRange(store), settings());
    expect(geo.colBands).toEqual([{ start: 0, end: 2 }]);
  });

  it('hidden columns ride along at zero width without consuming budget', () => {
    const store = makeStore();
    store.setCell(0, 5, { text: 'x' });
    for (let c = 0; c <= 5; c += 1) store.setCol(c, { width: 300 });
    store.setCol(2, { width: 300, hide: true });
    const geo = paginate(store, store.getActiveSheetId(), usedRange(store), settings());
    // widths 300,300,0(hidden) → 600 fits; col 3 would overflow → cut before it.
    expect(geo.colBands).toEqual([{ start: 0, end: 2 }, { start: 3, end: 4 }, { start: 5, end: 5 }]);
  });

  it('fitWidth scales so all used columns fit one page width', () => {
    const store = makeStore();
    store.setCell(0, 11, { text: 'x' }); // 12 default columns ≈ 768px > 745.7px
    const geo = paginate(store, store.getActiveSheetId(), usedRange(store), settings({ scaleMode: 'fitWidth' }));
    expect(geo.colBands).toHaveLength(1);
    expect(geo.scale).toBeCloseTo(CONTENT.w / (12 * 64), 9);
  });

  it('custom scale is respected as a percentage', () => {
    const store = makeStore();
    store.setCell(0, 0, { text: 'x' });
    const geo = paginate(store, store.getActiveSheetId(), usedRange(store), settings({ scalePercent: 50 }));
    expect(geo.scale).toBe(0.5);
  });

  it('degenerate empty sheet still yields one page', () => {
    const geo = paginate(makeStore(), 'sheet-1', { r1: 0, c1: 0, r2: 0, c2: 0 }, settings());
    expect(geo.pages).toEqual([{ index: 0, colStart: 0, colEnd: 0, rowStart: 0, rowEnd: 0 }]);
  });
});
