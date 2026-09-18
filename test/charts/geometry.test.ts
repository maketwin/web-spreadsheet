import { describe, it, expect } from 'vitest';
import { VirtualScroller } from '../../src/renderer/VirtualScroller';
import { COL_HEADER_HEIGHT, ROW_HEADER_WIDTH, TOTAL_COLS, TOTAL_ROWS } from '../../src/renderer/coordinate';
import {
  anchorToRect,
  rectToAnchor,
  shiftAnchorForInsert,
  shiftAnchorForDelete,
  normalizeAnchor,
  sameAnchor,
} from '../../src/charts/geometry';
import type { ChartAnchor } from '../../src/charts/types';

/**
 * Like the renderer's model: the scroller stores already-zoomed sizes, and
 * geometry functions receive the zoom factor separately.
 */
function scroller(zoom = 1, scrollTop = 0, scrollLeft = 0): VirtualScroller {
  const s = new VirtualScroller({
    totalRows: TOTAL_ROWS,
    totalCols: TOTAL_COLS,
    defaultRowHeight: 20 * zoom,
    defaultColWidth: 64 * zoom,
    viewportW: 800,
    viewportH: 600,
  });
  s.setScroll(scrollTop, scrollLeft);
  return s;
}

const anchor: ChartAnchor = {
  from: { r: 2, c: 1, offX: 10, offY: 5 },
  to: { r: 10, c: 6, offX: 32, offY: 15 },
};

describe('chart geometry', () => {
  it('maps an anchor to the viewport rect below/right of the headers at scroll 0', () => {
    const rect = anchorToRect(scroller(), 1, 0, 0, anchor);
    expect(rect.x).toBe(ROW_HEADER_WIDTH + 64 + 10);
    expect(rect.y).toBe(COL_HEADER_HEIGHT + 40 + 5);
    expect(rect.w).toBe((64 * 5 + 32) - 10);
    expect(rect.h).toBe((20 * 8 + 15) - 5);
  });

  it('round-trips rect → anchor at 100% zoom', () => {
    const g = scroller();
    const rect = anchorToRect(g, 1, 0, 0, anchor);
    expect(sameAnchor(rectToAnchor(g, 1, 0, 0, rect), anchor)).toBe(true);
  });

  it('round-trips at 200% zoom (offsets stay in unscaled content px)', () => {
    const g = scroller(2);
    const rect = anchorToRect(g, 2, 0, 0, anchor);
    expect(sameAnchor(rectToAnchor(g, 2, 0, 0, rect), anchor)).toBe(true);
  });

  it('scrolls the rect with the sheet', () => {
    const scrolled = anchorToRect(scroller(1, 120, 64), 1, 0, 0, anchor);
    const base = anchorToRect(scroller(), 1, 0, 0, anchor);
    expect(scrolled.y).toBe(base.y - 120);
    expect(scrolled.x).toBe(base.x - 64);
  });

  it('keeps frozen bands pinned while scrolled content slides underneath', () => {
    // Anchor fully inside the frozen strips ignores scroll.
    const frozen: ChartAnchor = { from: { r: 1, c: 1, offX: 0, offY: 0 }, to: { r: 2, c: 2, offX: 0, offY: 0 } };
    const rect = anchorToRect(scroller(1, 300, 300), 1, 2, 2, frozen);
    expect(rect.x).toBe(ROW_HEADER_WIDTH + 64);
    expect(rect.y).toBe(COL_HEADER_HEIGHT + 20);
    // Anchor beyond the freeze line shifts by the scroll delta.
    const moving: ChartAnchor = { from: { r: 5, c: 5, offX: 0, offY: 0 }, to: { r: 6, c: 6, offX: 0, offY: 0 } };
    const base = anchorToRect(scroller(), 1, 2, 2, moving);
    const scrolled = anchorToRect(scroller(1, 300, 300), 1, 2, 2, moving);
    expect(scrolled.x).toBe(base.x - 300);
    expect(scrolled.y).toBe(base.y - 300);
  });

  it('insert shifts edges at/after the start; delete slides back or clamps', () => {
    const moved = shiftAnchorForInsert(anchor, 'row', 5, 2);
    expect(moved.from.r).toBe(2);
    expect(moved.to.r).toBe(12);
    expect(moved.to.c).toBe(6);

    const back = shiftAnchorForDelete(moved, 'row', 5, 2);
    expect(sameAnchor(back, anchor)).toBe(true);

    // Edge inside the deleted band clamps to its start.
    const clamped = shiftAnchorForDelete(anchor, 'col', 0, 3);
    expect(clamped.from.c).toBe(0);
    expect(clamped.to.c).toBe(3);
  });

  it('normalizeAnchor orders flipped edges and clamps offsets', () => {
    const flipped = normalizeAnchor({ from: anchor.to, to: anchor.from }, TOTAL_ROWS, TOTAL_COLS);
    expect(flipped.from.r).toBe(2);
    expect(flipped.from.c).toBe(1);
    expect(flipped.to.r).toBe(10);
    expect(flipped.to.c).toBe(6);

    const clamped = normalizeAnchor({ from: { r: 5, c: 5, offX: -3, offY: 0 }, to: { r: 9_999_999, c: 9_999_999, offX: 0, offY: 0 } }, 1000, 26);
    expect(clamped.from.offX).toBe(0);
    expect(clamped.to.r).toBe(999);
    expect(clamped.to.c).toBe(25);
  });
});
