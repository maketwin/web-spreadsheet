import { describe, expect, it } from 'vitest';
import { FillHandle } from '../../src/fill/FillHandle';
import { COL_HEADER_HEIGHT, ROW_HEADER_WIDTH } from '../../src/renderer/coordinate';
import type { RangeAddress } from '../../src/selection/Range';
import type { VirtualScroller } from '../../src/renderer/VirtualScroller';

const CELL_W = 100;
const CELL_H = 30;

function makeHandle(selected: RangeAddress, onFill: (source: RangeAddress, target: RangeAddress, ctrl: boolean) => void): FillHandle {
  const scroller = {
    cellToPixel: (r: number, c: number) => ({ x: c * CELL_W, y: r * CELL_H }),
    getColWidth: () => CELL_W,
    getRowHeight: () => CELL_H,
    rowAtPixel: (y: number) => Math.floor(y / CELL_H),
    colAtPixel: (x: number) => Math.floor(x / CELL_W),
    totalWidth: () => Number.MAX_SAFE_INTEGER,
    totalHeight: () => Number.MAX_SAFE_INTEGER,
    scrollLeft: 0,
    scrollTop: 0,
  } as unknown as VirtualScroller;
  const canvas = {
    style: {},
    focus: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 3000, bottom: 4000, width: 3000, height: 4000 }),
  } as unknown as HTMLCanvasElement;
  return new FillHandle({ canvas, scroller, selectedRange: () => selected, onFill, invalidate: () => {} });
}

/** Pointer coordinates inside cell (r, c); handle sits on (r2, c2). */
const cellPoint = (r: number, c: number): { clientX: number; clientY: number } => ({
  clientX: ROW_HEADER_WIDTH + c * CELL_W + 10,
  clientY: COL_HEADER_HEIGHT + r * CELL_H + 10,
});

function drag(selected: RangeAddress, toR: number, toC: number): Array<[RangeAddress, RangeAddress, boolean]> {
  const calls: Array<[RangeAddress, RangeAddress, boolean]> = [];
  const h = makeHandle(selected, (s, t, c) => calls.push([s, t, c]));
  const handlePt = {
    x: ROW_HEADER_WIDTH + (selected.c2 + 1) * CELL_W,
    y: COL_HEADER_HEIGHT + (selected.r2 + 1) * CELL_H,
  };
  h.onMouseDown(new MouseEvent('mousedown', { clientX: handlePt.x, clientY: handlePt.y }));
  h.onMouseMove(new MouseEvent('mousemove', cellPoint(toR, toC)));
  h.onMouseUp();
  return calls;
}

describe('FillHandle drag targets', () => {
  it('extends the target downward', () => {
    const calls = drag({ r1: 5, c1: 0, r2: 6, c2: 0 }, 8, 0);
    expect(calls[0]![1]).toEqual({ r1: 5, c1: 0, r2: 8, c2: 0 });
  });

  it('extends the target upward past the top row', () => {
    const calls = drag({ r1: 5, c1: 0, r2: 6, c2: 0 }, 2, 0);
    expect(calls[0]![1]).toEqual({ r1: 2, c1: 0, r2: 6, c2: 0 });
  });

  it('extends the target leftward past the first column', () => {
    const calls = drag({ r1: 0, c1: 2, r2: 0, c2: 3 }, 0, 0);
    expect(calls[0]![1]).toEqual({ r1: 0, c1: 0, r2: 0, c2: 3 });
  });

  it('extends the target rightward', () => {
    const calls = drag({ r1: 0, c1: 0, r2: 0, c2: 1 }, 0, 4);
    expect(calls[0]![1]).toEqual({ r1: 0, c1: 0, r2: 0, c2: 4 });
  });

  it('keeps a horizontal drag horizontal across a tall selection', () => {
    const calls = drag({ r1: 0, c1: 0, r2: 5, c2: 0 }, 3, 3);
    expect(calls[0]![1]).toEqual({ r1: 0, c1: 0, r2: 5, c2: 3 });
  });

  it('keeps a vertical drag vertical across a wide selection', () => {
    const calls = drag({ r1: 0, c1: 0, r2: 0, c2: 5 }, 3, 2);
    expect(calls[0]![1]).toEqual({ r1: 0, c1: 0, r2: 3, c2: 5 });
  });

  it('does not extend when the pointer stays inside the source', () => {
    const calls = drag({ r1: 2, c1: 2, r2: 5, c2: 5 }, 3, 4);
    // Target equals the source → FillRangeCommand fills nothing.
    expect(calls[0]![1]).toEqual(calls[0]![0]);
  });
});

describe('FillHandle Ctrl tracking', () => {
  it('picks up Ctrl pressed mid-drag (Excel tracks the whole gesture)', () => {
    const calls: Array<[RangeAddress, RangeAddress, boolean]> = [];
    const selected: RangeAddress = { r1: 0, c1: 0, r2: 0, c2: 0 };
    const h = makeHandle(selected, (s, t, c) => calls.push([s, t, c]));
    const handlePt = { x: ROW_HEADER_WIDTH + CELL_W, y: COL_HEADER_HEIGHT + CELL_H };
    h.onMouseDown(new MouseEvent('mousedown', { clientX: handlePt.x, clientY: handlePt.y }));
    h.onMouseMove(new MouseEvent('mousemove', { ...cellPoint(2, 0), ctrlKey: true }));
    h.onMouseUp();
    expect(calls[0]![2]).toBe(true);
  });

  it('reports Ctrl not held for a plain drag', () => {
    const calls = drag({ r1: 0, c1: 0, r2: 0, c2: 0 }, 2, 0);
    expect(calls[0]![2]).toBe(false);
  });
});
