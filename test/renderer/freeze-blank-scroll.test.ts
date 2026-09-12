import { afterEach, describe, expect, it, vi } from 'vitest';
import { CanvasRenderer, ROW_HEIGHT, COL_WIDTH } from '../../src/renderer/CanvasRenderer';
import { Store } from '../../src/store/Store';

interface Rect { x: number; y: number; w: number; h: number }

function makeCanvas(w = 800, h = 400): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'clientWidth', { configurable: true, value: w });
  Object.defineProperty(canvas, 'clientHeight', { configurable: true, value: h });
  Object.defineProperty(canvas, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ left: 0, top: 0, width: w, height: h, right: w, bottom: h, x: 0, y: 0, toJSON: () => ({}) }),
  });
  document.body.append(canvas);
  return canvas;
}

function intersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const w = Math.min(a.x + a.w, b.x + b.w) - x;
  const h = Math.min(a.y + a.h, b.y + b.h) - y;
  return w > 0 && h > 0 ? { x, y, w, h } : null;
}

function installIntersectClipContext(): { ctx: Partial<CanvasRenderingContext2D>; activeClip: () => Rect | null } {
  const stack: Array<Rect | null> = [];
  let pending: Rect | null = null;
  let active: Rect | null = null;
  const ctx: Partial<CanvasRenderingContext2D> = {
    beginPath: vi.fn(() => { pending = null; }),
    clip: vi.fn(() => {
      if (pending === null) return;
      if (active === null) active = pending;
      else active = intersect(active, pending) ?? { x: 0, y: 0, w: 0, h: 0 };
      pending = null;
    }),
    fillRect: vi.fn(), fillText: vi.fn(), lineTo: vi.fn(),
    measureText: vi.fn(() => ({ width: 24 } as TextMetrics)),
    moveTo: vi.fn(),
    rect: vi.fn((x: number, y: number, w: number, h: number) => { pending = { x, y, w, h }; }),
    restore: vi.fn(() => { active = stack.pop() ?? null; }),
    save: vi.fn(() => { stack.push(active); }),
    scale: vi.fn(), setLineDash: vi.fn(), setTransform: vi.fn(), stroke: vi.fn(), strokeRect: vi.fn(),
    clearRect: vi.fn(), drawImage: vi.fn(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as CanvasRenderingContext2D);
  return { ctx, activeClip: () => active };
}

function installAnimationFrames(): Array<(t: number) => void> {
  const cbs: Array<(t: number) => void> = [];
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
    cbs.push(cb as (t: number) => void);
    return cbs.length;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
  return cbs;
}

function loadDemo(store: Store): void {
  const rows = [
    ['产品', 'Q1', 'Q2', 'Q3', 'Q4', '总计'],
    ['产品A', '100', '120', '150', '180', '550'],
    ['产品B', '80', '90', '110', '130', '410'],
    ['产品C', '200', '210', '230', '250', '890'],
    ['合计', '380', '420', '490', '560', '1850'],
  ];
  rows.forEach((row, r) => row.forEach((text, c) => store.setCell(r, c, { text })));
}

function collectVisible(ctx: Partial<CanvasRenderingContext2D>, activeClip: () => Rect | null): string[] {
  const visibleTexts: string[] = [];
  (ctx.fillText as ReturnType<typeof vi.fn>).mockImplementation((text: string, tx: number, ty: number) => {
    const clip = activeClip();
    if (clip !== null && (clip.w <= 0 || clip.h <= 0)) return;
    const box = { x: tx - 24, y: ty - 8, w: 48, h: 16 };
    if (clip === null || intersect(box, clip) !== null) visibleTexts.push(String(text));
  });
  return visibleTexts;
}

describe('freeze blank after scroll', () => {
  afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });

  it('after a small scroll, 合计 stays visible below the freeze line', () => {
    const { ctx, activeClip } = installIntersectClipContext();
    const callbacks = installAnimationFrames();
    const store = new Store();
    loadDemo(store);
    const renderer = new CanvasRenderer({ canvas: makeCanvas(), store });
    renderer.setFreeze(2, 2);
    renderer.scrollBy(COL_WIDTH * 1.5, ROW_HEIGHT * 1.5);
    const visibleTexts = collectVisible(ctx, activeClip);
    callbacks.forEach((cb) => cb(0));
    expect(visibleTexts).toContain('合计');
    expect(visibleTexts).toContain('产品A');
    renderer.destroy();
  });

  it('scrolling back to origin restores 产品B and column C at the freeze edge', () => {
    const { ctx, activeClip } = installIntersectClipContext();
    const callbacks = installAnimationFrames();
    const store = new Store();
    loadDemo(store);
    const renderer = new CanvasRenderer({ canvas: makeCanvas(), store });
    renderer.setFreeze(2, 2);
    renderer.scrollBy(COL_WIDTH * 2, ROW_HEIGHT * 4);
    callbacks.forEach((cb) => cb(0));
    renderer.scrollBy(-COL_WIDTH * 2, -ROW_HEIGHT * 4);
    const visibleTexts = collectVisible(ctx, activeClip);
    callbacks.forEach((cb) => cb(0));
    expect(renderer.scrollState()).toEqual({ left: 0, top: 0 });
    expect(visibleTexts).toContain('产品B');
    expect(visibleTexts).toContain('Q2');
    renderer.destroy();
  });

  it('re-syncing the same active cell does not yank scroll while panned under freeze', () => {
    installIntersectClipContext();
    installAnimationFrames();
    const store = new Store();
    loadDemo(store);
    const renderer = new CanvasRenderer({ canvas: makeCanvas(), store });
    renderer.setFreeze(2, 2);
    renderer.setSelection({ r1: 2, c1: 2, r2: 2, c2: 2 }, 'cell', { r: 2, c: 2 });
    renderer.scrollBy(COL_WIDTH * 2, ROW_HEIGHT * 2);
    const mid = renderer.scrollState();
    expect(mid.left).toBeGreaterThan(0);
    // React re-syncs the same selection — must not call ensureCellVisible again
    renderer.setSelection({ r1: 2, c1: 2, r2: 2, c2: 2 }, 'cell', { r: 2, c: 2 });
    expect(renderer.scrollState()).toEqual(mid);
    renderer.destroy();
  });

  it('Excel freeze hairline cuts through headers and setFreeze resets scroll to the freeze corner', () => {
    const { ctx } = installIntersectClipContext();
    const callbacks = installAnimationFrames();
    const store = new Store();
    loadDemo(store);
    const renderer = new CanvasRenderer({ canvas: makeCanvas(), store });
    renderer.scrollBy(COL_WIDTH * 3, ROW_HEIGHT * 5);
    expect(renderer.scrollState().left).toBeGreaterThan(0);
    renderer.setFreeze(2, 1); // Excel: freeze at B3 → rows above + col A
    expect(renderer.scrollState()).toEqual({ left: 0, top: 0 });
    callbacks.forEach((cb) => cb(0));
    // Excel draws the freeze line through the column header (y starts at 0).
    const moves = (ctx.moveTo as ReturnType<typeof vi.fn>).mock.calls as unknown as Array<[number, number]>;
    expect(moves.some(([, y]) => y === 0)).toBe(true);
    renderer.destroy();
  });


  it('frozen-strip grid stays pinned inside the freeze band after scrolling', () => {
    const { ctx } = installIntersectClipContext();
    const callbacks = installAnimationFrames();
    const store = new Store();
    loadDemo(store);
    const renderer = new CanvasRenderer({ canvas: makeCanvas(), store });
    renderer.setFreeze(1, 1);
    // Scroll far so the bug would collapse top/left strip grid into negative spans
    renderer.scrollBy(COL_WIDTH * 3, ROW_HEIGHT * 8);

    const segments: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
    let cur: { x: number; y: number } | null = null;
    (ctx.moveTo as ReturnType<typeof vi.fn>).mockImplementation((x: number, y: number) => { cur = { x, y }; });
    (ctx.lineTo as ReturnType<typeof vi.fn>).mockImplementation((x: number, y: number) => {
      if (cur !== null) segments.push({ x1: cur.x, y1: cur.y, x2: x, y2: y });
      cur = { x, y };
    });
    callbacks.forEach((cb) => cb(0));

    const freezeX = 46 + COL_WIDTH; // ROW_HEADER_WIDTH + one frozen col
    const freezeY = 20 + ROW_HEIGHT; // COL_HEADER_HEIGHT + one frozen row
    // Vertical hairlines in the top frozen strip (y within header..freezeY)
    const topStripV = segments.filter((s) => s.x1 === s.x2 && s.x1 > freezeX && Math.min(s.y1, s.y2) >= 20 && Math.max(s.y1, s.y2) <= freezeY + 1);
    expect(topStripV.length).toBeGreaterThan(0);
    // Every top-strip vertical segment must stay inside the frozen band (not collapsed above it)
    for (const s of topStripV) {
      expect(Math.abs(s.y2 - s.y1)).toBeGreaterThan(2);
      expect(Math.min(s.y1, s.y2)).toBeGreaterThanOrEqual(20);
      expect(Math.max(s.y1, s.y2)).toBeLessThanOrEqual(freezeY + 1);
    }
    // Horizontal hairlines in the left frozen strip (x within row-header..freezeX)
    const leftStripH = segments.filter((s) => s.y1 === s.y2 && s.y1 > freezeY && Math.min(s.x1, s.x2) >= 46 && Math.max(s.x1, s.x2) <= freezeX + 1);
    expect(leftStripH.length).toBeGreaterThan(0);
    renderer.destroy();
  });

});
