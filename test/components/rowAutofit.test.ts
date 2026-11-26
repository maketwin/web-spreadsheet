import { afterEach, describe, expect, it, vi } from 'vitest';
import { autoFitRowHeight, autofitRowHeights } from '../../src/components/rowAutofit';
import { autoFitColWidth } from '../../src/components/hooks/useCanvasRenderer';
import { COL_WIDTH, ROW_HEIGHT } from '../../src/renderer/coordinate';
import { Store } from '../../src/store/Store';
import { TOTAL_COLS, TOTAL_ROWS } from '../../src/util/gridSize';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('autoFitRowHeight', () => {
  it('computes the height from the stored cells of the row only (content in first 5 columns)', () => {
    const store = new Store();
    store.setCell(3, 0, { text: 'plain', styleId: 's0' });
    store.setStyle('s0', { fontSize: 18 }); // excelRowHeightPx(18,1) = 33
    store.setCell(3, 2, { text: 'wrapped long text here', styleId: 's2' });
    store.setStyle('s2', { wrap: true }); // est. 9 chars/line at 11pt → 3 lines → 60
    store.setCell(3, 4, { text: 'b', styleId: 's4' });
    store.setStyle('s4', { fontSize: 8 }); // excelRowHeightPx(8,1) = 15

    const getCell = vi.spyOn(Store.prototype, 'getCell');
    expect(autoFitRowHeight(store, 3)).toBe(60);
    // Stored cells of the row only — the count must not grow with TOTAL_COLS.
    expect(getCell.mock.calls.length).toBeLessThanOrEqual(10);
    // Empty row keeps the default height.
    expect(autoFitRowHeight(store, 4)).toBe(ROW_HEIGHT);
  });
});

describe('autofitRowHeights (selection)', () => {
  it('still grows rows for the selection font applied to empty cells', () => {
    const store = new Store();
    // Stored-but-empty cell inside the selection with a large font.
    store.setCell(8, 1, { text: '', styleId: 's8' });
    store.setStyle('s8', { fontSize: 24 }); // excelRowHeightPx(24,1) = 44
    store.setCell(9, 0, { text: 'tall', styleId: 's9' });
    store.setStyle('s9', { fontSize: 20 }); // excelRowHeightPx(20,1) = 36

    const heights = autofitRowHeights(store, { r1: 8, c1: 0, r2: 9, c2: 3 });
    expect(heights).toEqual([
      { r: 8, height: 44 },
      { r: 9, height: 36 },
    ]);
  });

  it('selection over fully empty rows keeps the default height', () => {
    const store = new Store();
    const heights = autofitRowHeights(store, { r1: 0, c1: 0, r2: 1, c2: 5 });
    expect(heights).toEqual([
      { r: 0, height: ROW_HEIGHT },
      { r: 1, height: ROW_HEIGHT },
    ]);
  });

  it('call counts do not grow with the grid; off-selection text still wins', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'anchor', styleId: 'a' });
    store.setStyle('a', { fontSize: 16 });
    store.setCell(0, TOTAL_COLS - 1, { text: 'far right on the same row', styleId: 'f' });
    store.setStyle('f', { fontSize: 30 }); // excelRowHeightPx(30,1) = 55

    const getCell = vi.spyOn(Store.prototype, 'getCell');
    const heights = autofitRowHeights(store, { r1: 0, c1: 0, r2: 0, c2: 2 });
    expect(heights).toEqual([{ r: 0, height: 55 }]);
    // 2 stored cells — not selection width + TOTAL_COLS.
    expect(getCell.mock.calls.length).toBeLessThanOrEqual(10);
  });
});

describe('autoFitColWidth', () => {
  it('measures the stored cells of the column only', () => {
    const store = new Store();
    store.setCell(0, 5, { text: '0123456789' });
    store.setCell(TOTAL_ROWS - 1, 5, { text: 'abc' }); // deep inside the address space
    store.setCell(3, 6, { text: 'other column with long text' });

    expect(autoFitColWidth(store, 5)).toBe(10 * 8 + 20);
    expect(autoFitColWidth(store, 7)).toBe(COL_WIDTH); // empty column → default

    const getCell = vi.spyOn(Store.prototype, 'getCell');
    autoFitColWidth(store, 5);
    // Stored cells of the column only — the count must not grow with TOTAL_ROWS.
    expect(getCell.mock.calls.length).toBeLessThanOrEqual(5);
  });
});
