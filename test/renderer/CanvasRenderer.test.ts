import { fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CanvasRenderer, canvasPointToCell, canvasPointToHeader, ROW_HEADER_WIDTH, COL_HEADER_HEIGHT, ROW_HEIGHT, COL_WIDTH, TOTAL_ROWS, TOTAL_COLS } from '../../src/renderer/CanvasRenderer';
import { Store } from '../../src/store/Store';

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

interface Rect { x: number; y: number; w: number; h: number }

function intersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const w = Math.min(a.x + a.w, b.x + b.w) - x;
  const h = Math.min(a.y + a.h, b.y + b.h) - y;
  return w > 0 && h > 0 ? { x, y, w, h } : null;
}

/** Like installCanvasContext but tracks the active clip rectangle across save/clip/restore. */
function installTrackingCanvasContext(): { ctx: Partial<CanvasRenderingContext2D>; activeClip: () => Rect | null } {
  const stack: Array<Rect | null> = [];
  let pending: Rect | null = null;
  let active: Rect | null = null;
  const ctx: Partial<CanvasRenderingContext2D> = {
    beginPath: vi.fn(() => { pending = null; }),
    clip: vi.fn(() => { if (pending !== null) active = pending; }),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    lineTo: vi.fn(),
    measureText: vi.fn(() => ({ width: 24 } as TextMetrics)),
    moveTo: vi.fn(),
    rect: vi.fn((x: number, y: number, w: number, h: number) => { pending = { x, y, w, h }; }),
    restore: vi.fn(() => { active = stack.pop() ?? null; }),
    save: vi.fn(() => { stack.push(active); }),
    scale: vi.fn(),
    setLineDash: vi.fn(),
    setTransform: vi.fn(),
    stroke: vi.fn(),
    strokeRect: vi.fn(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as CanvasRenderingContext2D);
  return { ctx, activeClip: () => active };
}

describe('CanvasRenderer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('instantiates and destroys', () => {
    installCanvasContext();
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
    const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);

    const renderer = new CanvasRenderer({ canvas: makeCanvas(), store: new Store() });
    renderer.destroy();

    expect(raf).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledWith(1);
  });

  it('renders after store subscription without throwing', () => {
    installCanvasContext();
    const callbacks = installAnimationFrames();
    const store = new Store();
    const renderer = new CanvasRenderer({ canvas: makeCanvas(), store });

    callbacks[0]?.(0);
    store.setCell(0, 0, { text: 'A1' });

    expect(() => callbacks[1]?.(16)).not.toThrow();
    renderer.destroy();
  });


  it('scrollBy clamps to content and triggers repaint', () => {
    installCanvasContext();
    const callbacks = installAnimationFrames();
    const renderer = new CanvasRenderer({ canvas: makeCanvas(), store: new Store() });
    callbacks.shift()?.(0);

    renderer.scrollBy(500, 1000);
    // Grid viewport is 300-46 wide / 150-24 tall; content is far larger.
    expect(renderer.scrollState().left).toBe(500);
    expect(renderer.scrollState().top).toBe(1000);

    renderer.scrollBy(-10_000, -10_000);
    expect(renderer.scrollState()).toEqual({ left: 0, top: 0 });
    renderer.destroy();
  });

  it('clips header labels so a mostly scrolled-out row/column never paints into the corner', () => {
    const { ctx, activeClip } = installTrackingCanvasContext();
    const callbacks = installAnimationFrames();
    const renderer = new CanvasRenderer({ canvas: makeCanvas(), store: new Store() });
    callbacks.shift()?.(0);

    // Scroll so row 17 (0-based 16) shows only a 0.5px sliver and column A is
    // mostly hidden under the row headers — the user-reported overlap scenario.
    renderer.scrollBy(52.5, 339.5);

    const CORNER = { x: 0, y: 0, w: ROW_HEADER_WIDTH, h: COL_HEADER_HEIGHT };
    const VIEWPORT = { x: 0, y: 0, w: 300, h: 150 };
    // Capture the clip active at the moment of each fillText call, not after the frame.
    const drawn: Array<{ text: string; box: Rect; clip: Rect | null }> = [];
    (ctx.fillText as ReturnType<typeof vi.fn>).mockImplementation((text: string, tx: number, ty: number) => {
      drawn.push({ text: String(text), box: { x: tx - 12, y: ty - 6, w: 24, h: 12 }, clip: activeClip() });
    });
    callbacks.shift()?.(16);

    expect(drawn.length).toBeGreaterThan(0);
    for (const { text, box, clip } of drawn) {
      const visible = intersect(box, clip ?? VIEWPORT);
      // null visible = glyph fully clipped away, which also paints nothing in the corner.
      const inCorner = visible === null ? null : intersect(visible, CORNER);
      expect({ text, inCorner }).toEqual({ text, inCorner: null });
    }
    // Fully visible rows/columns still get their labels.
    const texts = drawn.map((call) => call.text);
    expect(texts).toContain('18');
    expect(texts).toContain('19');
    expect(texts).toContain('B');
    renderer.destroy();
  });

  it('freezes: scrollable header labels clip at the freeze line, never covering pinned labels', () => {
    const { ctx, activeClip } = installTrackingCanvasContext();
    const callbacks = installAnimationFrames();
    const renderer = new CanvasRenderer({ canvas: makeCanvas(), store: new Store() });
    renderer.setFreeze(1, 1);
    callbacks.shift()?.(0);

    // Scroll so scrollable row 3 (index 2) and column B (index 1) slide under the
    // frozen strips — the user-reported overlap-with-freeze scenario.
    renderer.scrollBy(52, 35);

    const CORNER = { x: 0, y: 0, w: ROW_HEADER_WIDTH, h: COL_HEADER_HEIGHT };
    const FROZEN_COL_SEG = { x: ROW_HEADER_WIDTH, y: 0, w: 64, h: COL_HEADER_HEIGHT };
    const FROZEN_ROW_SEG = { x: 0, y: COL_HEADER_HEIGHT, w: ROW_HEADER_WIDTH, h: 20 };
    const VIEWPORT = { x: 0, y: 0, w: 300, h: 150 };
    const drawn: Array<{ text: string; box: Rect; clip: Rect | null }> = [];
    (ctx.fillText as ReturnType<typeof vi.fn>).mockImplementation((text: string, tx: number, ty: number) => {
      drawn.push({ text: String(text), box: { x: tx - 12, y: ty - 6, w: 24, h: 12 }, clip: activeClip() });
    });
    callbacks.shift()?.(16);

    expect(drawn.length).toBeGreaterThan(0);
    for (const { text, box, clip } of drawn) {
      const visible = intersect(box, clip ?? VIEWPORT);
      if (visible === null) continue;
      // Only calls made inside a frozen-segment clip may paint there — a scrollable
      // label sliding under the strip must be clipped away at the freeze line.
      const inFrozenSegmentClip = clip !== null && (
        (clip.x === ROW_HEADER_WIDTH && clip.y === 0 && clip.w === 64 && clip.h === COL_HEADER_HEIGHT) ||
        (clip.x === 0 && clip.y === COL_HEADER_HEIGHT && clip.w === ROW_HEADER_WIDTH && clip.h === 20));
      const coversFrozen = !inFrozenSegmentClip && (
        intersect(visible, FROZEN_COL_SEG) !== null || intersect(visible, FROZEN_ROW_SEG) !== null);
      expect({ text, coversFrozen }).toEqual({ text, coversFrozen: false });
      const inCorner = intersect(visible, CORNER);
      expect({ text, inCorner }).toEqual({ text, inCorner: null });
    }
    // Pinned frozen labels and fully visible scrollable labels still render.
    const texts = drawn.map((call) => call.text);
    expect(texts).toContain('A');
    expect(texts).toContain('1');
    expect(texts).toContain('C');
    renderer.destroy();
  });

  it('setSelection scrolls an off-screen active cell into view', () => {
    installCanvasContext();
    const callbacks = installAnimationFrames();
    const renderer = new CanvasRenderer({ canvas: makeCanvas(), store: new Store() });
    callbacks.shift()?.(0);

    // Row 50 starts at 50*20=1000px — far below the 130px-tall grid viewport.
    renderer.setSelection({ r1: 50, c1: 0, r2: 50, c2: 0 }, 'cell', { r: 50, c: 0 });
    const { top } = renderer.scrollState();
    expect(top).toBeGreaterThan(0);
    // Bottom of row 50 must be within the visible window.
    expect(51 * ROW_HEIGHT).toBeLessThanOrEqual(top + (150 - COL_HEADER_HEIGHT));
    renderer.destroy();
  });

  it('setSelection with sheet kind never scrolls (Excel Ctrl+A keeps the viewport)', () => {
    installCanvasContext();
    const callbacks = installAnimationFrames();
    const renderer = new CanvasRenderer({ canvas: makeCanvas(), store: new Store() });
    callbacks.shift()?.(0);

    renderer.setSelection({ r1: 0, c1: 0, r2: TOTAL_ROWS - 1, c2: TOTAL_COLS - 1 }, 'sheet', { r: TOTAL_ROWS - 1, c: TOTAL_COLS - 1 });
    expect(renderer.scrollState()).toEqual({ left: 0, top: 0 });
    renderer.destroy();
  });

  it('hit tests resolve deep cells without linear scans', () => {
    installCanvasContext();
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    const renderer = new CanvasRenderer({ canvas: makeCanvas(), store: new Store() });
    expect(raf).toHaveBeenCalled();

    renderer.scrollBy(0, 500 * ROW_HEIGHT);
    expect(renderer.scrollState().top).toBe(500 * ROW_HEIGHT);
    // Point just below the column header maps to row 500 while scrolled.
    const cell = renderer.cellAtPoint(10 + ROW_HEADER_WIDTH + 5, 20 + COL_HEADER_HEIGHT + 5);
    expect(cell?.r).toBe(500);
    renderer.destroy();
  });

  it('freeze: hit tests map frozen strips and the displaced scrollable quadrant', () => {
    installCanvasContext();
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    const renderer = new CanvasRenderer({ canvas: makeCanvas(), store: new Store() });
    renderer.setFreeze(1, 1);
    renderer.scrollBy(0, 400);

    // Frozen row strip (viewport y 24..44): still row 0 despite scrollTop=400.
    expect(renderer.cellAtPoint(10 + ROW_HEADER_WIDTH + 90, 20 + COL_HEADER_HEIGHT + 10)).toEqual({ r: 0, c: 1 });
    // Frozen col strip (viewport x 46..126): still col 0 despite horizontal position.
    expect(renderer.cellAtPoint(10 + ROW_HEADER_WIDTH + 5, 20 + COL_HEADER_HEIGHT + 30)).toEqual({ r: 21, c: 0 });
    // Scrollable quadrant starts below/right of the strips: row 21 (row 20 slid under the strip).
    expect(renderer.cellAtPoint(10 + ROW_HEADER_WIDTH + 90, 20 + COL_HEADER_HEIGHT + 21)).toEqual({ r: 21, c: 1 });
    renderer.destroy();
  });

  it('freeze: frozen cells keep a fixed viewport rect while scrolled', () => {
    installCanvasContext();
    installAnimationFrames();
    const renderer = new CanvasRenderer({ canvas: makeCanvas(), store: new Store() });
    renderer.setFreeze(1, 1);

    expect(renderer.getCellViewportRect(0, 0)).toEqual({ x: ROW_HEADER_WIDTH, y: COL_HEADER_HEIGHT, w: COL_WIDTH, h: ROW_HEIGHT });
    renderer.scrollBy(COL_WIDTH * 3, ROW_HEIGHT * 30);
    // Corner cell does not move.
    expect(renderer.getCellViewportRect(0, 0)).toEqual({ x: ROW_HEADER_WIDTH, y: COL_HEADER_HEIGHT, w: COL_WIDTH, h: ROW_HEIGHT });
    // First cell below/right of the freeze lines sits exactly at the frozen edges:
    // row 30 / col 3 slid under the strips (pos == scroll), so (31, 4) is at the corner.
    expect(renderer.getCellViewportRect(31, 4)).toEqual({ x: ROW_HEADER_WIDTH + COL_WIDTH, y: COL_HEADER_HEIGHT + ROW_HEIGHT, w: COL_WIDTH, h: ROW_HEIGHT });
    renderer.destroy();
  });

  it('freeze: selection of a cell slid under the freeze strips does not paint on frozen cells', () => {
    const { ctx, activeClip } = installTrackingCanvasContext();
    const callbacks = installAnimationFrames();
    const renderer = new CanvasRenderer({ canvas: makeCanvas(), store: new Store() });
    // Freeze at C3 → rows 0..1 and cols 0..1 pinned (same as Excel Freeze Panes on C3)
    renderer.setFreeze(2, 2);
    renderer.setSelection({ r1: 2, c1: 2, r2: 2, c2: 2 }, 'cell', { r: 2, c: 2 });
    // Slide row 3 / col C under the frozen strips (headers become A B | D … and 1 2 | 4 …)
    renderer.scrollBy(COL_WIDTH, ROW_HEIGHT);

    const FROZEN_CORNER = { x: ROW_HEADER_WIDTH, y: COL_HEADER_HEIGHT, w: COL_WIDTH * 2, h: ROW_HEIGHT * 2 };
    const VIEWPORT = { x: 0, y: 0, w: 300, h: 150 };
    const leaked: Array<{ box: Rect; clip: Rect | null }> = [];
    (ctx.strokeRect as ReturnType<typeof vi.fn>).mockImplementation((x: number, y: number, w: number, h: number) => {
      if (w <= 10 || h <= 10) return; // ignore fill-handle chrome
      const box = { x, y, w, h };
      const clip = activeClip();
      const visible = intersect(box, clip ?? VIEWPORT);
      if (visible !== null && intersect(visible, FROZEN_CORNER) !== null) leaked.push({ box, clip });
    });
    callbacks.forEach((cb) => cb(0));

    // Precondition: C3's unscrolled cellVP lands in the frozen corner (same slot as B2).
    const under = renderer.getCellViewportRect(2, 2);
    expect(under.x).toBeLessThan(ROW_HEADER_WIDTH + COL_WIDTH * 2);
    expect(under.y).toBeLessThan(COL_HEADER_HEIGHT + ROW_HEIGHT * 2);
    // Quadrant clip must discard that geometry so nothing paints on frozen cells.
    expect(leaked).toEqual([]);
    renderer.destroy();
  });

  it('freeze: selecting a frozen cell does not yank the scroll position', () => {
    installCanvasContext();
    installAnimationFrames();
    const renderer = new CanvasRenderer({ canvas: makeCanvas(), store: new Store() });
    renderer.setFreeze(1, 1);
    renderer.scrollBy(COL_WIDTH * 5, ROW_HEIGHT * 50);
    const before = renderer.scrollState();

    renderer.setSelection({ r1: 0, c1: 0, r2: 0, c2: 0 }, 'cell', { r: 0, c: 0 });
    expect(renderer.scrollState()).toEqual(before);

    // A scrollable cell below the view still scrolls into view.
    renderer.setSelection({ r1: 100, c1: 0, r2: 100, c2: 0 }, 'cell', { r: 100, c: 0 });
    expect(renderer.scrollState().top).toBeGreaterThan(before.top);
    renderer.destroy();
  });

  it('freeze: paints frozen header labels and strip content after scrolling', () => {
    const ctx = installCanvasContext();
    const callbacks = installAnimationFrames();
    const store = new Store();
    store.setCell(0, 0, { text: 'frozenA1' });
    store.setCell(0, 2, { text: 'frozenRow0C' });
    // scrollTop=400 → content y=400 sits under the freeze; the first row at the
    // freeze edge is row 21 (400+ROW_HEIGHT). Put the probe text there.
    store.setCell(21, 0, { text: 'scrollRow21A' });
    const renderer = new CanvasRenderer({ canvas: makeCanvas(), store });

    renderer.setFreeze(1, 1);
    renderer.scrollBy(0, 400);
    callbacks[0]?.(0);

    const texts = (ctx.fillText as ReturnType<typeof vi.fn>).mock.calls.map((call: readonly unknown[]) => String(call[0]));
    // Frozen corner + row-strip text survive the scroll.
    expect(texts).toContain('frozenA1');
    expect(texts).toContain('frozenRow0C');
    // Frozen column shows the scrolled row's content at the freeze edge.
    expect(texts).toContain('scrollRow21A');
    // Frozen header labels stay painted.
    expect(texts).toContain('A');
    expect(texts).toContain('1');
    renderer.destroy();
  });

  it('converts canvas coordinates to cell addresses', () => {
    const canvas = makeCanvas();

    expect(canvasPointToCell(canvas, 10 + ROW_HEADER_WIDTH + 5, 20 + COL_HEADER_HEIGHT + 5)).toEqual({ r: 0, c: 0 });
    expect(canvasPointToCell(canvas, 10 + ROW_HEADER_WIDTH + COL_WIDTH * 2 + 5, 20 + COL_HEADER_HEIGHT + ROW_HEIGHT * 2 + 5)).toEqual({ r: 2, c: 2 });
  });

  it('converts zoomed canvas coordinates to cell addresses', () => {
    const canvas = makeCanvas();

    expect(canvasPointToCell(canvas, 10 + ROW_HEADER_WIDTH + COL_WIDTH * 2 + 5, 20 + COL_HEADER_HEIGHT + ROW_HEIGHT * 2 + 5, 0, 0, 200)).toEqual({ r: 1, c: 1 });
  });

  it('ignores row and column headers during coordinate conversion', () => {
    const canvas = makeCanvas();

    expect(canvasPointToCell(canvas, 40, 50)).toBeNull();
    expect(canvasPointToCell(canvas, 80, 30)).toBeNull();
  });

  it('converts zoomed header coordinates to column addresses', () => {
    const canvas = makeCanvas();

    expect(canvasPointToHeader(canvas, 10 + ROW_HEADER_WIDTH + COL_WIDTH * 2 + 5, 20 + 5, 0, 0, 200)).toEqual({ type: 'column', c: 1 });
  });

  it('emits mousedown cell clicks with converted coordinates', () => {
    installCanvasContext();
    const callbacks = installAnimationFrames();
    const onCellClick = vi.fn();
    const renderer = new CanvasRenderer({ canvas: makeCanvas(), store: new Store(), onCellClick });

    fireEvent.mouseDown(document.querySelector('canvas') as HTMLCanvasElement, { clientX: 10 + ROW_HEADER_WIDTH + COL_WIDTH + 30, clientY: 20 + COL_HEADER_HEIGHT + ROW_HEIGHT + 5 });

    expect(onCellClick).toHaveBeenCalledWith({ r: 1, c: 1 });
    expect(callbacks.length).toBe(1);
    renderer.destroy();
  });

  it('starts a normal range drag from the inside of an edge cell', () => {
    installCanvasContext();
    installAnimationFrames();
    const onCellClick = vi.fn();
    const onSelectionChange = vi.fn();
    const onMoveRange = vi.fn();
    const canvas = makeCanvas();
    const renderer = new CanvasRenderer({
      canvas,
      store: new Store(),
      selectedRange: { r1: 0, c1: 0, r2: 2, c2: 2 },
      selectionKind: 'range',
      activeCell: { r: 0, c: 0 },
      onCellClick,
      onSelectionChange,
      onMoveRange,
    });

    fireEvent.mouseDown(canvas, { clientX: 10 + ROW_HEADER_WIDTH + COL_WIDTH + 50, clientY: 20 + COL_HEADER_HEIGHT + 12 });
    fireEvent.mouseMove(window, { clientX: 10 + ROW_HEADER_WIDTH + COL_WIDTH * 3 + 50, clientY: 20 + COL_HEADER_HEIGHT + ROW_HEIGHT * 2 + 12 });

    expect(onCellClick).toHaveBeenCalledWith({ r: 0, c: 1 });
    expect(onSelectionChange).toHaveBeenCalledWith({ r1: 0, c1: 1, r2: 2, c2: 3 }, { r: 2, c: 3 }, { r: 0, c: 1 });
    expect(onMoveRange).not.toHaveBeenCalled();
    renderer.destroy();
  });

  it('moves a selected range only when dragging the rendered selection border', () => {
    installCanvasContext();
    installAnimationFrames();
    const onMoveRange = vi.fn();
    const canvas = makeCanvas();
    const renderer = new CanvasRenderer({
      canvas,
      store: new Store(),
      selectedRange: { r1: 0, c1: 0, r2: 2, c2: 2 },
      selectionKind: 'range',
      activeCell: { r: 0, c: 0 },
      onMoveRange,
    });

    fireEvent.mouseDown(canvas, { clientX: 10 + ROW_HEADER_WIDTH + COL_WIDTH + 50, clientY: 20 + COL_HEADER_HEIGHT + 2 });
    fireEvent.mouseMove(window, { clientX: 10 + ROW_HEADER_WIDTH + COL_WIDTH * 5 + 50, clientY: 20 + COL_HEADER_HEIGHT + 2 });
    fireEvent.mouseUp(window);

    expect(onMoveRange).toHaveBeenCalledWith({ r1: 0, c1: 0, r2: 2, c2: 2 }, { r1: 0, c1: 4, r2: 0, c2: 4 }, false);
    renderer.destroy();
  });

  it('freeze: move-drag clamps at the freeze boundary instead of entering the frozen band', () => {
    installCanvasContext();
    installAnimationFrames();
    const onMoveRange = vi.fn();
    const canvas = makeCanvas();
    const renderer = new CanvasRenderer({
      canvas,
      store: new Store(),
      selectedRange: { r1: 2, c1: 2, r2: 3, c2: 3 },
      selectionKind: 'range',
      activeCell: { r: 2, c: 2 },
      onMoveRange,
    });
    renderer.setFreeze(1, 1);

    // Grab the selection's top border (viewport x≈286, y≈65) and drag up into the frozen row strip.
    fireEvent.mouseDown(canvas, { clientX: 10 + ROW_HEADER_WIDTH + COL_WIDTH * 3, clientY: 20 + COL_HEADER_HEIGHT + 2 * ROW_HEIGHT + 1 });
    fireEvent.mouseMove(window, { clientX: 10 + ROW_HEADER_WIDTH + COL_WIDTH * 3, clientY: 20 + COL_HEADER_HEIGHT + 10 });
    fireEvent.mouseUp(window);

    // Target row clamps to the first scrollable row (row 1), never row 0.
    expect(onMoveRange).toHaveBeenCalledWith({ r1: 2, c1: 2, r2: 3, c2: 3 }, { r1: 1, c1: 2, r2: 1, c2: 2 }, false);
    renderer.destroy();
  });

  it('move-drag dropped back onto the source is a no-op, not a data wipe', () => {
    installCanvasContext();
    installAnimationFrames();
    const onMoveRange = vi.fn();
    const canvas = makeCanvas();
    const renderer = new CanvasRenderer({
      canvas,
      store: new Store(),
      selectedRange: { r1: 2, c1: 2, r2: 3, c2: 3 },
      selectionKind: 'range',
      activeCell: { r: 2, c: 2 },
      onMoveRange,
    });

    // Drag away (target changes), then back onto the source before releasing.
    fireEvent.mouseDown(canvas, { clientX: 10 + ROW_HEADER_WIDTH + COL_WIDTH * 3, clientY: 20 + COL_HEADER_HEIGHT + 2 * ROW_HEIGHT + 1 });
    fireEvent.mouseMove(window, { clientX: 10 + ROW_HEADER_WIDTH + COL_WIDTH * 3, clientY: 20 + COL_HEADER_HEIGHT + 6 * ROW_HEIGHT });
    fireEvent.mouseMove(window, { clientX: 10 + ROW_HEADER_WIDTH + COL_WIDTH * 3, clientY: 20 + COL_HEADER_HEIGHT + 2 * ROW_HEIGHT + 1 });
    fireEvent.mouseUp(window);

    expect(onMoveRange).not.toHaveBeenCalled();
    renderer.destroy();
  });

  it('freeze: a range straddling the freeze boundary cannot be moved', () => {
    installCanvasContext();
    installAnimationFrames();
    const onMoveRange = vi.fn();
    const canvas = makeCanvas();
    const renderer = new CanvasRenderer({
      canvas,
      store: new Store(),
      selectedRange: { r1: 0, c1: 0, r2: 2, c2: 1 },
      selectionKind: 'range',
      activeCell: { r: 0, c: 0 },
      onMoveRange,
    });
    renderer.setFreeze(2, 2);

    // Grab the straddling selection's top border and drag down; target pins to the source anchor.
    fireEvent.mouseDown(canvas, { clientX: 10 + ROW_HEADER_WIDTH + COL_WIDTH, clientY: 20 + COL_HEADER_HEIGHT + 1 });
    fireEvent.mouseMove(window, { clientX: 10 + ROW_HEADER_WIDTH + COL_WIDTH, clientY: 20 + COL_HEADER_HEIGHT + 4 * ROW_HEIGHT });
    fireEvent.mouseUp(window);

    expect(onMoveRange).not.toHaveBeenCalled();
    renderer.destroy();
  });

  it('freeze: move-drag outline paints at the clamped target, never inside the frozen strip', () => {
    const ctx = installCanvasContext();
    const callbacks = installAnimationFrames();
    const onMoveRange = vi.fn();
    const canvas = makeCanvas();
    const renderer = new CanvasRenderer({
      canvas,
      store: new Store(),
      selectedRange: { r1: 3, c1: 3, r2: 4, c2: 4 },
      selectionKind: 'range',
      activeCell: { r: 3, c: 3 },
      onMoveRange,
    });
    renderer.setFreeze(1, 1);
    callbacks[0]?.(0);

    // Press the selection's top border (row 3 top y=84) and drag up into the frozen row strip.
    fireEvent.mouseDown(canvas, { clientX: 10 + ROW_HEADER_WIDTH + COL_WIDTH * 3 + 40, clientY: 20 + COL_HEADER_HEIGHT + 3 * ROW_HEIGHT + 1 });
    fireEvent.mouseMove(window, { clientX: 10 + ROW_HEADER_WIDTH + COL_WIDTH * 3 + 40, clientY: 20 + COL_HEADER_HEIGHT + 10 });
    callbacks[1]?.(16);

    // The dashed target outline (lineWidth 1.5 strokeRect, distinct from the 2px selection
    // stroke) must start at the first scrollable row (y = 24 + ROW_HEIGHT), not row 0 (y=24).
    const dashedYs = (ctx.strokeRect as ReturnType<typeof vi.fn>).mock.calls
      .map((c: readonly unknown[]) => Number(c[1]))
      .filter((y: number) => Math.abs(y - COL_HEADER_HEIGHT - ROW_HEIGHT) < 2 || Math.abs(y - COL_HEADER_HEIGHT) < 2);
    expect(dashedYs.length).toBeGreaterThan(0);
    expect(dashedYs.every((y: number) => y >= COL_HEADER_HEIGHT + ROW_HEIGHT - 1)).toBe(true);

    fireEvent.mouseUp(window);
    expect(onMoveRange).toHaveBeenCalledWith({ r1: 3, c1: 3, r2: 4, c2: 4 }, { r1: 1, c1: 3, r2: 1, c2: 3 }, false);
    renderer.destroy();
  });

  it('does not move a range when the selection border is clicked without dragging', () => {
    installCanvasContext();
    installAnimationFrames();
    const onMoveRange = vi.fn();
    const canvas = makeCanvas();
    const renderer = new CanvasRenderer({
      canvas,
      store: new Store(),
      selectedRange: { r1: 0, c1: 0, r2: 2, c2: 2 },
      selectionKind: 'range',
      activeCell: { r: 0, c: 0 },
      onMoveRange,
    });

    fireEvent.mouseDown(canvas, { clientX: 10 + ROW_HEADER_WIDTH + COL_WIDTH + 50, clientY: 20 + COL_HEADER_HEIGHT + 2 });
    fireEvent.mouseUp(window);

    expect(onMoveRange).not.toHaveBeenCalled();
    renderer.destroy();
  });

  it('extends column selection while dragging column headers', () => {
    installCanvasContext();
    installAnimationFrames();
    const onColumnSelect = vi.fn();
    const canvas = makeCanvas();
    const renderer = new CanvasRenderer({ canvas, store: new Store(), onColumnSelect });

    fireEvent.mouseDown(canvas, { clientX: 10 + ROW_HEADER_WIDTH + 5, clientY: 20 + 5 });
    fireEvent.mouseMove(window, { clientX: 10 + ROW_HEADER_WIDTH + COL_WIDTH * 2 + 5, clientY: 20 + 5 });

    expect(onColumnSelect).toHaveBeenNthCalledWith(1, 0, false);
    expect(onColumnSelect).toHaveBeenNthCalledWith(2, 2, true);
    renderer.destroy();
  });

  it('extends row selection while dragging row headers', () => {
    installCanvasContext();
    installAnimationFrames();
    const onRowSelect = vi.fn();
    const canvas = makeCanvas();
    const renderer = new CanvasRenderer({ canvas, store: new Store(), onRowSelect });

    fireEvent.mouseDown(canvas, { clientX: 10 + 5, clientY: 20 + COL_HEADER_HEIGHT + 5 });
    fireEvent.mouseMove(window, { clientX: 10 + 5, clientY: 20 + COL_HEADER_HEIGHT + ROW_HEIGHT * 2 + 5 });

    expect(onRowSelect).toHaveBeenNthCalledWith(1, 0, false);
    expect(onRowSelect).toHaveBeenNthCalledWith(2, 2, true);
    renderer.destroy();
  });

  it('theme change event schedules invalidation and repaint', () => {
    installCanvasContext();
    const callbacks = installAnimationFrames();
    const renderer = new CanvasRenderer({ canvas: makeCanvas(), store: new Store() });
    callbacks[0]?.(0);

    window.dispatchEvent(new CustomEvent('ss:theme-changed'));

    expect(callbacks[1]).toBeDefined();
    renderer.destroy();
  });

  it('reads CSS variables for each paint', () => {
    const ctx = installCanvasContext();
    const callbacks = installAnimationFrames();
    document.documentElement.style.setProperty('--ss-bg', '#101010');
    const renderer = new CanvasRenderer({ canvas: makeCanvas(), store: new Store() });

    callbacks[0]?.(0);

    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 300, 150);
    expect(ctx.fillStyle).toBe('#444444');
    document.documentElement.style.removeProperty('--ss-bg');
    renderer.destroy();
  });

  it('renders formulas when showFormula is enabled', () => {
    const ctx = installCanvasContext();
    const callbacks = installAnimationFrames();
    const store = new Store();
    store.setCell(0, 0, { text: '3', formula: '=SUM(1,2)' });
    const renderer = new CanvasRenderer({ canvas: makeCanvas(), store, showFormula: true });

    callbacks[0]?.(0);

    expect(ctx.fillText).toHaveBeenCalledWith('=SUM(1,2)', expect.any(Number), expect.any(Number));
    renderer.destroy();
  });

  it('aligns cell text vertically and defaults to middle', () => {
    const paintText = (valign?: 'top' | 'middle' | 'bottom'): number => {
      const ctx = installCanvasContext();
      const callbacks = installAnimationFrames();
      const store = new Store();
      store.setCell(0, 0, { text: 'A1', styleId: 'style-1' });
      store.setStyle('style-1', valign === undefined ? {} : { valign });
      const renderer = new CanvasRenderer({ canvas: makeCanvas(), store });
      callbacks[0]?.(0);
      const call = (ctx.fillText as ReturnType<typeof vi.fn>).mock.calls.find((items) => items[0] === 'A1');
      renderer.destroy();
      document.body.innerHTML = '';
      vi.restoreAllMocks();
      if (call === undefined) throw new Error('Text was not painted');
      return Number(call[2]);
    };

    expect(paintText()).toBe(paintText('middle'));
    expect(paintText('bottom')).toBeGreaterThan(paintText('top'));
  });

  it('skips non-first cells in merged regions', () => {
    const ctx = installCanvasContext();
    const callbacks = installAnimationFrames();
    const store = new Store();
    store.addMerge('A1:B2');
    store.setCell(0, 0, { text: 'merged' });
    store.setCell(0, 1, { text: 'hidden1' });
    store.setCell(1, 0, { text: 'hidden2' });
    store.setCell(1, 1, { text: 'hidden3' });
    const renderer = new CanvasRenderer({ canvas: makeCanvas(), store });

    callbacks[0]?.(0);

    // Only the first cell's text should be rendered — the other 3 should be skipped
    const allCalls = (ctx.fillText as ReturnType<typeof vi.fn>).mock.calls.map(
      (call: readonly unknown[]) => String(call[0]),
    );
    expect(allCalls).toContain('merged');
    expect(allCalls).not.toContain('hidden1');
    expect(allCalls).not.toContain('hidden2');
    expect(allCalls).not.toContain('hidden3');
    renderer.destroy();
  });
});

function installAnimationFrames(): FrameRequestCallback[] {
  const callbacks: FrameRequestCallback[] = [];
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    callbacks.push(callback);
    return callbacks.length;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
  return callbacks;
}

describe('CanvasRenderer AutoFilter header-row buttons', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('opens the filter popup only when the in-cell dropdown button is clicked', () => {
    installCanvasContext();
    installAnimationFrames();
    const onAutoFilterClick = vi.fn();
    const store = new Store();
    store.setCell(0, 0, { text: 'Name' });
    store.setCell(1, 0, { text: 'Alice' });
    store.setAutoFilter({ range: { r1: 0, c1: 0, r2: 1, c2: 0 }, criteria: {} });
    const canvas = makeCanvas();
    const renderer = new CanvasRenderer({ canvas, store, onAutoFilterClick });

    // Middle of the header cell: plain cell click, no popup.
    fireEvent.mouseDown(canvas, { clientX: 10 + ROW_HEADER_WIDTH + 20, clientY: 20 + COL_HEADER_HEIGHT + 10 });
    expect(onAutoFilterClick).not.toHaveBeenCalled();

    // Column-letter header: selects the column, no popup.
    fireEvent.mouseDown(canvas, { clientX: 10 + ROW_HEADER_WIDTH + 30, clientY: 20 + 10 });
    expect(onAutoFilterClick).not.toHaveBeenCalled();

    // Right edge of the header-row cell (the Excel dropdown button zone).
    fireEvent.mouseDown(canvas, { clientX: 10 + ROW_HEADER_WIDTH + COL_WIDTH - 8, clientY: 20 + COL_HEADER_HEIGHT + 10 });
    expect(onAutoFilterClick).toHaveBeenCalledWith(0, 0, expect.any(Number), expect.any(Number));
    renderer.destroy();
  });
});

describe('CanvasRenderer collapsed (hidden) rows', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  function setup(): { renderer: CanvasRenderer; store: Store } {
    installCanvasContext();
    installAnimationFrames();
    const store = new Store();
    for (let r = 0; r < 5; r += 1) store.setCell(r, 0, { text: `v${r}` });
    const canvas = makeCanvas();
    const renderer = new CanvasRenderer({ canvas, store });
    return { renderer, store };
  }

  it('collapses a hidden row to zero height and shifts lower rows up', () => {
    const { renderer, store } = setup();
    expect(renderer.getCellViewportRect(3, 0)).toEqual({ x: ROW_HEADER_WIDTH, y: COL_HEADER_HEIGHT + 3 * ROW_HEIGHT, w: COL_WIDTH, h: ROW_HEIGHT });
    store.setRow(2, { hide: true });
    expect(renderer.getCellViewportRect(2, 0).h).toBe(0);
    // Excel fold-up: row 3's data now renders where row 2 was.
    expect(renderer.getCellViewportRect(3, 0).y).toBe(COL_HEADER_HEIGHT + 2 * ROW_HEIGHT);
    renderer.destroy();
  });

  it('restores the row height when unhidden', () => {
    const { renderer, store } = setup();
    store.setRow(2, { hide: true });
    store.setRow(2, { hide: false });
    expect(renderer.getCellViewportRect(2, 0).h).toBe(ROW_HEIGHT);
    expect(renderer.getCellViewportRect(3, 0).y).toBe(COL_HEADER_HEIGHT + 3 * ROW_HEIGHT);
    renderer.destroy();
  });

  it('maps clicks in the collapsed slot to the next visible row', () => {
    const { renderer, store } = setup();
    store.setRow(2, { hide: true });
    // Canvas y inside the collapsed slot's former area maps to row 3 (canvas top = 20).
    const hit = renderer.rowAtPoint(20 + COL_HEADER_HEIGHT + 2 * ROW_HEIGHT + 5);
    expect(hit).toBe(3);
    renderer.destroy();
  });
});
