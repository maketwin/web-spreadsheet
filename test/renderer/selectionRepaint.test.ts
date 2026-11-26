import { afterEach, describe, expect, it, vi } from 'vitest';
import { CanvasRenderer } from '../../src/renderer/CanvasRenderer';
import { Store } from '../../src/store/Store';
import { ROW_HEADER_WIDTH, COL_HEADER_HEIGHT } from '../../src/renderer/coordinate';

/** Grid viewport of the jsdom test canvas: 300-46 x 150-20 px. */
const GRID_W = 300 - ROW_HEADER_WIDTH;
const GRID_H = 150 - COL_HEADER_HEIGHT;
const VISIBLE_ROWS = Math.ceil(GRID_H / 20);
const VISIBLE_COLS = Math.ceil(GRID_W / 64);

type DrawCall = readonly unknown[];
type CtxMock = ReturnType<typeof vi.fn>;

interface RecordedCtx {
  ctx: {
    fillRect: CtxMock;
    fillText: CtxMock;
    measureText: CtxMock;
    drawImage: CtxMock;
  };
  fillRectCalls: () => Array<{ style: string; x: number; y: number; w: number; h: number }>;
}

/** Stub 2D context that records calls; drawImage/clearRect are included so
 * snapshotGrid actually runs (the plain stubs in CanvasRenderer.test.ts omit
 * them, which makes snapshotGrid return early). */
function installRecordingContext(): RecordedCtx {
  const mocks = {
    beginPath: vi.fn(),
    clip: vi.fn(),
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    lineTo: vi.fn(),
    measureText: vi.fn(() => ({ width: 24 }) as TextMetrics),
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
  const fills: Array<{ style: string; x: number; y: number; w: number; h: number }> = [];
  mocks.fillRect.mockImplementation(function (
    this: { fillStyle?: unknown },
    x: number,
    y: number,
    w: number,
    h: number,
  ) {
    fills.push({ style: String(this.fillStyle), x, y, w, h });
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(mocks as unknown as CanvasRenderingContext2D);
  return {
    ctx: { fillRect: mocks.fillRect, fillText: mocks.fillText, measureText: mocks.measureText, drawImage: mocks.drawImage },
    fillRectCalls: () => fills,
  };
}

function installAnimationFrames(): FrameRequestCallback[] {
  const callbacks: FrameRequestCallback[] = [];
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    callbacks.push(callback);
    return callbacks.length;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
  return callbacks;
}

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

function fillKey(fill: { style: string; x: number; y: number; w: number; h: number }): string {
  return `${fill.style}|${fill.x},${fill.y},${fill.w},${fill.h}`;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

describe('selection-triggered grid repaint', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('repaints only header chrome on a selection change: no cell text, no measuring, no snapshot', () => {
    const { ctx } = installRecordingContext();
    const callbacks = installAnimationFrames();
    const store = new Store();
    // Every visible cell holds a number, so the full cell pipeline would
    // fillText AND measureText (hash-overflow check) for each of them.
    for (let r = 0; r < VISIBLE_ROWS + 2; r += 1) {
      for (let c = 0; c < VISIBLE_COLS + 2; c += 1) {
        const v = r * 10 + c;
        store.setCell(r, c, { text: String(v), value: v });
      }
    }
    const renderer = new CanvasRenderer({ canvas: makeCanvas(), store });
    callbacks[0]?.(0); // initial full paint (snapshot happens here)
    ctx.drawImage.mockClear();
    const fillsBefore = ctx.fillText.mock.calls.length;
    const measuresBefore = ctx.measureText.mock.calls.length;

    // Selection change far from the origin: prev/next header bands stay separate.
    renderer.setSelection({ r1: 3, c1: 1, r2: 3, c2: 1 }, 'cell', { r: 3, c: 1 });
    callbacks[1]?.(16);

    const fills = ctx.fillText.mock.calls.length - fillsBefore;
    const measures = ctx.measureText.mock.calls.length - measuresBefore;
    // Cell text must not be re-laid-out or re-measured (cells did not change).
    expect(measures).toBe(0);
    // The grid bitmap must not be re-snapshotted: no cell pixel changed.
    expect(ctx.drawImage).not.toHaveBeenCalled();
    // fillText only for header labels (row numbers + column letters). The old
    // behavior also re-painted every visible cell text under the header band
    // clips (~VISIBLE_ROWS*VISIBLE_COLS extra fillText calls).
    expect(fills).toBeGreaterThan(0);
    expect(fills).toBeLessThanOrEqual(2 * (VISIBLE_ROWS + VISIBLE_COLS));
    // Header labels really are among what was painted.
    const texts = ctx.fillText.mock.calls.slice(fillsBefore).map((call: DrawCall) => String(call[0]));
    expect(texts).toContain('A');
    expect(texts).toContain('1');
    renderer.destroy();
  });

  it('repaints the full pipeline on a cell-content change (measure + snapshot), as before', () => {
    const { ctx } = installRecordingContext();
    const callbacks = installAnimationFrames();
    const store = new Store();
    store.setStyle('nf', { numberFormat: '#,##0.00' });
    for (let r = 0; r < VISIBLE_ROWS + 2; r += 1) {
      for (let c = 0; c < VISIBLE_COLS + 2; c += 1) {
        const v = r * 10 + c;
        store.setCell(r, c, { text: String(v), value: v, styleId: 'nf' });
      }
    }
    const renderer = new CanvasRenderer({ canvas: makeCanvas(), store });
    callbacks[0]?.(0);
    expect(ctx.measureText.mock.calls.length).toBeGreaterThan(0); // cell text measured
    expect(ctx.drawImage).toHaveBeenCalledTimes(1); // grid snapshotted

    store.setCell(2, 2, { text: '987654', value: 987654, styleId: 'nf' });
    callbacks[1]?.(16);

    expect(ctx.measureText.mock.calls.length).toBeGreaterThan(0);
    expect(ctx.drawImage).toHaveBeenCalledTimes(2);
    renderer.destroy();
  });

  it('still snapshots a header-only repaint when the blit cache is invalid', () => {
    const { ctx } = installRecordingContext();
    const callbacks = installAnimationFrames();
    const renderer = new CanvasRenderer({ canvas: makeCanvas(), store: new Store() });
    callbacks[0]?.(0);
    expect(ctx.drawImage).toHaveBeenCalledTimes(1);

    // Force the scroll-blit cache invalid without dirtying any cell pixels.
    (renderer as unknown as { blitValid: boolean }).blitValid = false;
    ctx.drawImage.mockClear();
    renderer.setSelection({ r1: 4, c1: 2, r2: 4, c2: 2 }, 'cell', { r: 4, c: 2 });
    callbacks[1]?.(16);

    // Next scroll would otherwise degrade to a full repaint.
    expect(ctx.drawImage).toHaveBeenCalledTimes(1);
    renderer.destroy();
  });

  it('freeze: a selection crossing the frozen region tints headers exactly like a full repaint', () => {
    // Selection starts at row 0 (inside the frozen row strip) but at column C,
    // so its two header bands do not touch and stay header-only after clamping.
    const selection = { r1: 0, c1: 2, r2: 5, c2: 5 };
    const activeCell = { r: 0, c: 2 };
    const opts = {
      frozenRows: 2,
      frozenCols: 2,
      selectedRange: selection,
      selectionKind: 'range' as const,
      activeCell,
    };

    // Renderer A: its only frame is a full paint of the frozen state.
    const a = installRecordingContext();
    const aFrames = installAnimationFrames();
    const rendererA = new CanvasRenderer({ canvas: makeCanvas(), store: new Store(), ...opts });
    aFrames[0]?.(0);
    const fullHeaderTexts = a.ctx.fillText.mock.calls
      .map((call: DrawCall) => call as unknown as [string, number, number])
      .filter(([, tx, ty]) => tx < ROW_HEADER_WIDTH || ty < COL_HEADER_HEIGHT)
      .map(([text, tx, ty]) => `${text}@${tx},${ty}`);
    const fullHeaderFills = a.fillRectCalls()
      .filter(({ x, y, w, h }) => (x < ROW_HEADER_WIDTH && w <= ROW_HEADER_WIDTH) || (y < COL_HEADER_HEIGHT && h <= COL_HEADER_HEIGHT))
      .map(fillKey);
    rendererA.destroy();

    // Renderer B: full paint first, then a selection-change frame whose dirty
    // rects fall inside the header strips (the header-only fast path).
    const b = installRecordingContext();
    const bFrames = installAnimationFrames();
    const rendererB = new CanvasRenderer({ canvas: makeCanvas(), store: new Store(), ...opts });
    bFrames[0]?.(0);
    b.ctx.fillText.mockClear();
    b.fillRectCalls().length = 0;
    rendererB.setSelection(selection, 'range', activeCell);
    bFrames[1]?.(16);

    // Each drained header band runs its own paintHeaders pass, so the fast
    // frame's calls are a superset of one full pass — compare as sets: same
    // labels, same geometry, same styles, nothing extra.
    const fastHeaderTexts = unique(b.ctx.fillText.mock.calls.map((call: DrawCall) => {
      const [text, tx, ty] = call as unknown as [string, number, number];
      return `${text}@${tx},${ty}`;
    }));
    // Same header-position filter as the full-paint side: the overlay canvas
    // shares the stub, so selection chrome (fill handle etc.) appears here too.
    const fastHeaderFills = unique(b.fillRectCalls()
      .filter(({ x, y, w, h }) => (x < ROW_HEADER_WIDTH && w <= ROW_HEADER_WIDTH) || (y < COL_HEADER_HEIGHT && h <= COL_HEADER_HEIGHT))
      .map(fillKey));
    expect(fastHeaderTexts.sort()).toEqual([...new Set(fullHeaderTexts)].sort());
    expect(fastHeaderFills.sort()).toEqual([...new Set(fullHeaderFills)].sort());
    // No cell text was measured: the fast frame never entered the cell pipeline.
    expect(b.ctx.measureText.mock.calls.length).toBe(0);
    // Precondition: the tint was really painted in both frozen and scrollable header segments.
    expect(fullHeaderFills.length).toBeGreaterThan(4);
    rendererB.destroy();
  });

  it('clearing extra ranges that are already clear repaints nothing (a plain click does this every time)', () => {
    const { ctx } = installRecordingContext();
    installAnimationFrames();
    const renderer = new CanvasRenderer({ canvas: makeCanvas(), store: new Store() });
    const invalidate = vi.spyOn(renderer as unknown as { invalidateAll: () => void }, 'invalidateAll');
    ctx.drawImage.mockClear();

    renderer.setExtraRanges([]); // already empty: nothing to repaint
    expect(invalidate).not.toHaveBeenCalled();
    renderer.setExtraRanges([{ r1: 1, c1: 1, r2: 2, c2: 2 }]);
    expect(invalidate).toHaveBeenCalledTimes(1);
    renderer.setExtraRanges([{ r1: 1, c1: 1, r2: 2, c2: 2 }]); // same range, fresh object
    expect(invalidate).toHaveBeenCalledTimes(1);
    renderer.setExtraRanges([]);
    expect(invalidate).toHaveBeenCalledTimes(2);
    renderer.destroy();
  });
});
