import { afterEach, describe, expect, it, vi } from 'vitest';
import { PrintPainter } from '../../src/print/PrintPainter';
import { PRINT_DPI_SCALE, contentPx, DEFAULT_PRINT_SETTINGS } from '../../src/print/types';
import { Store } from '../../src/store/Store';

/** jsdom has no canvas implementation — stub the 2D context (CanvasRenderer.test pattern). */
function installCanvasContext(): { ctx: Record<string, unknown>; fillStyles: string[] } {
  const fillStyles: string[] = [];
  const ctx: Record<string, unknown> = {
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
    setLineDash: vi.fn(),
    setTransform: vi.fn(),
    stroke: vi.fn(),
    textAlign: 'left',
    textBaseline: 'middle',
  };
  Object.defineProperty(ctx, 'fillStyle', {
    configurable: true,
    get: () => fillStyles[fillStyles.length - 1] ?? '',
    set: (v: unknown) => fillStyles.push(String(v)),
  });
  Object.defineProperty(ctx, 'globalAlpha', { configurable: true, value: 1, writable: true });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  return { ctx, fillStyles };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PrintPainter', () => {
  it('produces a content-area canvas at print DPI with white background', () => {
    const { ctx, fillStyles } = installCanvasContext();
    const store = new Store();
    store.setCell(0, 0, { text: 'Hello' });
    const painter = new PrintPainter(store, store.getActiveSheetId());
    const canvas = painter.paint({ index: 0, colStart: 0, colEnd: 0, rowStart: 0, rowEnd: 0 }, 1, DEFAULT_PRINT_SETTINGS);

    const content = contentPx(DEFAULT_PRINT_SETTINGS);
    expect(canvas.width).toBe(Math.round(content.w * PRINT_DPI_SCALE));
    expect(canvas.height).toBe(Math.round(content.h * PRINT_DPI_SCALE));
    expect(ctx.setTransform).toHaveBeenCalledWith(PRINT_DPI_SCALE, 0, 0, PRINT_DPI_SCALE, 0, 0);
    expect(fillStyles[0]).toBe('#ffffff');
  });

  it('paints cell text, styled fills, gridlines and merge anchors', () => {
    const { ctx, fillStyles } = installCanvasContext();
    const store = new Store();
    store.setStyle('s1', { bgcolor: '#ff0000', bold: true, border: { bottom: 'solid' } });
    store.setCell(0, 0, { text: 'Red', styleId: 's1' });
    store.setCell(1, 0, { text: 'Plain' });
    store.setCell(2, 2, { text: 'Merged' });
    store.addMerge('C3:D4');
    const painter = new PrintPainter(store, store.getActiveSheetId());
    painter.paint({ index: 0, colStart: 0, colEnd: 4, rowStart: 0, rowEnd: 4 }, 1, DEFAULT_PRINT_SETTINGS);

    expect(fillStyles).toContain('#ff0000');
    expect(ctx.fillText).toHaveBeenCalledWith('Red', expect.any(Number), expect.any(Number));
    expect(ctx.fillText).toHaveBeenCalledWith('Plain', expect.any(Number), expect.any(Number));
    expect(ctx.fillText).toHaveBeenCalledWith('Merged', expect.any(Number), expect.any(Number));
    // Gridlines drawn as one batched stroke path.
    expect(ctx.moveTo).toHaveBeenCalled();
    expect(ctx.stroke).toHaveBeenCalled();
  });

  it('skips text on merge-covered (non-anchor) cells and gridlines inside merges', () => {
    const { ctx } = installCanvasContext();
    const store = new Store();
    store.setCell(2, 2, { text: 'Anchor' });
    store.setCell(2, 3, { text: 'Covered' }); // overwritten by merge membership
    store.addMerge('C3:D4');
    const painter = new PrintPainter(store, store.getActiveSheetId());
    painter.paint({ index: 0, colStart: 0, colEnd: 5, rowStart: 0, rowEnd: 5 }, 1, DEFAULT_PRINT_SETTINGS);

    expect(ctx.fillText).toHaveBeenCalledWith('Anchor', expect.any(Number), expect.any(Number));
    expect(ctx.fillText).not.toHaveBeenCalledWith('Covered', expect.any(Number), expect.any(Number));
  });

  it('draws gridlines in pixel space across the full band (regression: index-as-pixel stubs)', () => {
    const { ctx } = installCanvasContext();
    const store = new Store();
    store.setCell(4, 4, { text: 'x' }); // used band = cols 0..4 × rows 0..4 (5×64px wide, 5×20px tall)
    const painter = new PrintPainter(store, store.getActiveSheetId());
    painter.paint({ index: 0, colStart: 0, colEnd: 4, rowStart: 0, rowEnd: 4 }, 1, DEFAULT_PRINT_SETTINGS);

    const moves = (ctx.moveTo as unknown as ReturnType<typeof vi.fn>).mock.calls as Array<[number, number]>;
    const lines = (ctx.lineTo as unknown as ReturnType<typeof vi.fn>).mock.calls as Array<[number, number]>;
    // Horizontal line at the row-1 boundary spans the full 5-column width (not a 5px stub).
    expect(moves).toContainEqual([0, 20]);
    expect(lines).toContainEqual([320, 20]);
    // Vertical line at the col-1 boundary spans the full 5-row height.
    expect(moves).toContainEqual([64, 0]);
    expect(lines).toContainEqual([64, 100]);
    // Outer boundary edges are drawn too (Excel gridlines box the printed range).
    expect(moves).toContainEqual([320, 0]);
    expect(lines).toContainEqual([320, 100]);
    expect(moves).toContainEqual([0, 100]);
    expect(lines).toContainEqual([320, 100]);
  });

  it('never throws on an empty sheet', () => {
    installCanvasContext();
    const store = new Store();
    const painter = new PrintPainter(store, store.getActiveSheetId());
    expect(() => painter.paint({ index: 0, colStart: 0, colEnd: 0, rowStart: 0, rowEnd: 0 }, 1, DEFAULT_PRINT_SETTINGS)).not.toThrow();
  });
});
