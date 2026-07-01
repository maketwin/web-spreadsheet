import { describe, expect, it } from 'vitest';
import { VirtualScroller } from '../../src/renderer/VirtualScroller';

function makeScroller(): VirtualScroller {
  return new VirtualScroller({
    totalRows: 100,
    totalCols: 10,
    defaultRowHeight: 25,
    defaultColWidth: 100,
    viewportW: 1_000,
    viewportH: 600,
  });
}

describe('VirtualScroller', () => {
  it('calculates default visible range at scroll 0,0', () => {
    const scroller = makeScroller();

    expect(scroller.getVisibleRange()).toEqual({
      startRow: 0,
      endRow: 24,
      startCol: 0,
      endCol: 10,
    });
  });

  it('calculates visible range when scrolled down', () => {
    const scroller = makeScroller();

    scroller.setScroll(1_000, 0);

    expect(scroller.getVisibleRange().startRow).toBe(40);
  });

  it('converts cell coordinates to pixels', () => {
    const scroller = makeScroller();

    expect(scroller.cellToPixel(0, 0)).toEqual({ x: 0, y: 0 });
    expect(scroller.cellToPixel(2, 3)).toEqual({ x: 300, y: 50 });
  });

  it('uses custom row height in visible range and pixel calculation', () => {
    const scroller = makeScroller();

    scroller.setRowHeight(0, 50);

    expect(scroller.getRowHeight(0)).toBe(50);
    expect(scroller.cellToPixel(2, 0)).toEqual({ x: 0, y: 75 });
  });
});
