import { afterEach, describe, expect, it, vi } from 'vitest';
import { AxisIndex } from '../../src/renderer/AxisIndex';
import { CanvasRenderer, COL_WIDTH, ROW_HEADER_WIDTH } from '../../src/renderer/CanvasRenderer';
import { VirtualScroller } from '../../src/renderer/VirtualScroller';
import { Store } from '../../src/store/Store';
import { TOTAL_COLS, TOTAL_ROWS } from '../../src/util/gridSize';

function makeCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'clientWidth', { configurable: true, value: 300 });
  Object.defineProperty(canvas, 'clientHeight', { configurable: true, value: 150 });
  Object.defineProperty(canvas, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ left: 10, top: 20, width: 300, height: 150, right: 310, bottom: 170, x: 10, y: 20, toJSON: () => ({}) }),
  });
  document.body.append(canvas);
  return canvas;
}

function installCanvasContext(): Partial<CanvasRenderingContext2D> {
  const ctx: Partial<CanvasRenderingContext2D> = {
    beginPath: vi.fn(),
    clip: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    lineTo: vi.fn(),
    measureText: vi.fn(() => ({ width: 24 } as TextMetrics)),
    moveTo: vi.fn(),
    rect: vi.fn(),
    restore: vi.fn(),
    save: vi.fn(),
    scale: vi.fn(),
    setLineDash: vi.fn(),
    setTransform: vi.fn(),
    stroke: vi.fn(),
    strokeRect: vi.fn(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as CanvasRenderingContext2D);
  return ctx;
}

function installAnimationFrames(): FrameRequestCallback[] {
  const callbacks: FrameRequestCallback[] = [];
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { callbacks.push(cb); return callbacks.length; });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
  return callbacks;
}

describe('AxisIndex.reset', () => {
  it('restores every index to the default and matches a freshly built axis', () => {
    const fresh = new AxisIndex(TOTAL_ROWS, 20);
    const axis = new AxisIndex(TOTAL_ROWS, 20);
    axis.setSize(5, 99);
    axis.setSize(900_000, 0); // hidden row: explicit 0, distinct from unset
    axis.setDefaultSize(25);
    axis.reset(20);
    expect(axis.getSize(5)).toBe(20);
    expect(axis.getSize(900_000)).toBe(20);
    expect(axis.getSize(TOTAL_ROWS - 1)).toBe(20);
    expect(axis.position(1000)).toBe(fresh.position(1000));
    expect(axis.position(TOTAL_ROWS)).toBe(fresh.position(TOTAL_ROWS));
    expect(axis.indexAt(123_456)).toBe(fresh.indexAt(123_456));
    expect(axis.indexAt(20_000_000)).toBe(fresh.indexAt(20_000_000));
    expect(axis.total()).toBe(fresh.total());
    expect(axis.total()).toBe(TOTAL_ROWS * 20);
  });

  it('reset clears explicit sizes; NaN still means unset, 0 still means hidden', () => {
    const axis = new AxisIndex(100, 20);
    axis.setSize(7, 0);
    axis.setSize(8, 35);
    axis.reset(20);
    expect(axis.getSize(7)).toBe(20);
    expect(axis.getSize(8)).toBe(20);
    axis.setSize(8, 0); // re-hide after reset: explicit 0 survives as 0
    expect(axis.getSize(8)).toBe(0);
    expect(axis.getSize(9)).toBe(20); // unset falls back to the default
    axis.unsetSize(8);
    expect(axis.getSize(8)).toBe(20);
    expect(axis.total()).toBe(100 * 20);
  });
});

describe('axis span sums (prefix-delta path for grid-edge ranges)', () => {
  it('colWidthSpan matches a direct sum across the whole axis', () => {
    const sc = new VirtualScroller({ totalRows: TOTAL_ROWS, totalCols: TOTAL_COLS, defaultRowHeight: 20, defaultColWidth: 64, viewportW: 300, viewportH: 150 });
    sc.setColWidth(5, 33.5);
    sc.setColWidth(TOTAL_COLS - 1, 0);
    let direct = 0;
    for (let c = 0; c < TOTAL_COLS; c += 1) direct += sc.getColWidth(c);
    expect(sc.colWidthSpan(0, TOTAL_COLS - 1)).toBe(direct);
    expect(sc.colWidthSpan(4, 9)).toBe(33.5 + 64 * 5);
  });

  it('rowHeightSpan honors hidden (0-height) rows inside the span', () => {
    const sc = new VirtualScroller({ totalRows: TOTAL_ROWS, totalCols: TOTAL_COLS, defaultRowHeight: 20, defaultColWidth: 64, viewportW: 300, viewportH: 150 });
    sc.setRowHeight(900_000, 0);
    expect(sc.rowHeightSpan(899_000, 901_000)).toBe(2001 * 20 - 20);
  });
});

describe('renderer axis sync at Excel scale', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('syncs axis sizes with O(entries) setSize calls across create / sheet switch / zoom', () => {
    const store = new Store();
    // 10,000 row-height entries scattered across the 1,048,576-row address space.
    for (let i = 0; i < 10_000; i += 1) store.setRow(i * 100 + 7, { height: 22 });
    for (let c = 0; c < 10; c += 1) store.setCol(c * 1_500, { width: 90 });

    const setSize = vi.spyOn(AxisIndex.prototype, 'setSize');
    const canvas = makeCanvas();
    installCanvasContext();
    installAnimationFrames();
    const renderer = new CanvasRenderer({ canvas, store, devicePixelRatio: 1 });

    // 10,000 rows + 10 cols + a small constant. A per-index walk of the whole
    // address space would have called setSize 1,064,960 times per pass.
    const PASS_GUARD = 20_100;
    expect(setSize.mock.calls.length).toBeLessThanOrEqual(PASS_GUARD);

    const firstId = store.getActiveSheetId();
    const otherId = store.addSheet('Other');
    const afterCreate = setSize.mock.calls.length;
    store.activateSheet(otherId); // switch to the empty sheet
    expect(setSize.mock.calls.length - afterCreate).toBeLessThanOrEqual(100);
    store.activateSheet(firstId); // switch back
    expect(setSize.mock.calls.length - afterCreate).toBeLessThanOrEqual(PASS_GUARD);

    renderer.setViewOptions({ zoom: 150 }); // re-sync at the new zoom
    expect(setSize.mock.calls.length - afterCreate).toBeLessThanOrEqual(2 * PASS_GUARD);
    renderer.destroy();
  });
});

describe('textOverflowSpan stops at the visible area', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  function makeRenderer(store: Store): CanvasRenderer {
    installCanvasContext();
    installAnimationFrames();
    return new CanvasRenderer({ canvas: makeCanvas(), store, devicePixelRatio: 1 });
  }

  function spanOf(renderer: CanvasRenderer): (r: number, c: number, x: number, cw: number, align: 'left' | 'center' | 'right') => { left: number; right: number } {
    return (renderer as unknown as {
      textOverflowSpan: (r: number, c: number, x: number, cw: number, align: 'left' | 'center' | 'right') => { left: number; right: number };
    }).textOverflowSpan.bind(renderer);
  }

  const GRID_RIGHT = ROW_HEADER_WIDTH + (300 - ROW_HEADER_WIDTH);
  const GRID_LEFT = ROW_HEADER_WIDTH;

  it('left-aligned overflow never scans past the visible right edge', () => {
    const getCell = vi.spyOn(Store.prototype, 'getCell');
    const renderer = makeRenderer(new Store());
    getCell.mockClear();
    // 300px canvas → 254px grid → 4 visible columns at 64px each.
    const span = spanOf(renderer)(0, 0, ROW_HEADER_WIDTH, COL_WIDTH, 'left');
    expect(span.right).toBe(GRID_RIGHT);
    expect(span.right).toBeLessThanOrEqual(GRID_RIGHT);
    expect(span.left).toBe(GRID_LEFT);
    // Each scanned neighbor costs 2 getCell calls (cell + style); the loop may
    // visit at most visibleCols + 2 of them.
    expect(getCell.mock.calls.length).toBeLessThanOrEqual(2 * (4 + 2));
    renderer.destroy();
  });

  it('right-aligned overflow never scans past the visible left edge', () => {
    const getCell = vi.spyOn(Store.prototype, 'getCell');
    const renderer = makeRenderer(new Store());
    getCell.mockClear();
    const span = spanOf(renderer)(0, 3, ROW_HEADER_WIDTH + 3 * COL_WIDTH, COL_WIDTH, 'right');
    expect(span.left).toBe(GRID_LEFT);
    expect(getCell.mock.calls.length).toBeLessThanOrEqual(2 * (4 + 2));
    renderer.destroy();
  });

  it('a blocking neighbor still stops the overflow scan exactly as before', () => {
    const store = new Store();
    store.setCell(0, 2, { text: 'blocker' });
    const renderer = makeRenderer(store);
    // Neighbor col 1 is empty, col 2 blocks: right edge = own cell + col 1
    // (start 46 + own 64 + col 1's 64 = 174), identical to the unbounded scan.
    const span = spanOf(renderer)(0, 0, ROW_HEADER_WIDTH, COL_WIDTH, 'left');
    expect(span.right).toBe(ROW_HEADER_WIDTH + 2 * COL_WIDTH);
    renderer.destroy();
  });
});
