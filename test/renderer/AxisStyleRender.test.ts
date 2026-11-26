import { afterEach, describe, expect, it, vi } from 'vitest';
import { CanvasRenderer, COL_HEADER_HEIGHT, ROW_HEADER_WIDTH } from '../../src/renderer/CanvasRenderer';
import { SetRangeStyleCommand } from '../../src/commands/impl/SetRangeStyle';
import { CommandManager } from '../../src/commands/CommandManager';
import { Store } from '../../src/store/Store';
import { TOTAL_COLS, TOTAL_ROWS } from '../../src/util/gridSize';

import type { RangeAddress } from '../../src/selection/Range';

function makeCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'clientWidth', { configurable: true, value: 300 });
  Object.defineProperty(canvas, 'clientHeight', { configurable: true, value: 150 });
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
    measureText: vi.fn(() => ({ width: 24 }) as TextMetrics),
    moveTo: vi.fn(),
    rect: vi.fn(),
    restore: vi.fn(),
    save: vi.fn(),
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
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    callbacks.push(callback);
    return callbacks.length;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
  return callbacks;
}

const wholeColumn = (c: number): RangeAddress => ({ r1: 0, c1: c, r2: TOTAL_ROWS - 1, c2: c });
const wholeRow = (r: number): RangeAddress => ({ r1: r, c1: 0, r2: r, c2: TOTAL_COLS - 1 });

interface Fill { readonly style: string; readonly x: number; readonly y: number; readonly w: number; readonly h: number }

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('renderer axis default styles', () => {
  it('paints the column default fill on empty cells of the column', () => {
    const ctx = installCanvasContext();
    const fills: Fill[] = [];
    (ctx.fillRect as unknown as (x: number, y: number, w: number, h: number) => void) = (x: number, y: number, w: number, h: number): void => {
      fills.push({ style: String(ctx.fillStyle), x, y, w, h });
    };
    const callbacks = installAnimationFrames();
    const store = new Store();
    const cm = new CommandManager(store);
    cm.execute.bind(cm)(new SetRangeStyleCommand({ ...wholeColumn(1), style: { bgcolor: '#123456' } }));

    const renderer = new CanvasRenderer({ canvas: makeCanvas(), store });
    callbacks[0]?.(0);
    renderer.destroy();

    // The visible part of column B (empty cells included) shows the fill.
    const painted = fills.filter((f) => f.style === '#123456');
    const rowsPainted = new Set(painted.map((f) => Math.round((f.y - COL_HEADER_HEIGHT - 1) / 20)));
    expect(rowsPainted.size).toBeGreaterThanOrEqual(5);
    // Column A stays unfilled.
    expect(fills.some((f) => f.style === '#123456' && f.x <= ROW_HEADER_WIDTH + 1)).toBe(false);
  });

  it('row default beats column default on the crossing cell', () => {
    const ctx = installCanvasContext();
    const fills: Fill[] = [];
    (ctx.fillRect as unknown as (x: number, y: number, w: number, h: number) => void) = (x: number, y: number, w: number, h: number): void => {
      fills.push({ style: String(ctx.fillStyle), x, y, w, h });
    };
    const callbacks = installAnimationFrames();
    const store = new Store();
    const cm = new CommandManager(store);
    cm.execute.bind(cm)(new SetRangeStyleCommand({ ...wholeColumn(0), style: { bgcolor: '#ff0000' } }));
    cm.execute.bind(cm)(new SetRangeStyleCommand({ ...wholeRow(2), style: { bgcolor: '#0000ff' } }));

    const renderer = new CanvasRenderer({ canvas: makeCanvas(), store });
    callbacks[0]?.(0);
    renderer.destroy();

    // Row 3 of column A paints blue; other visible rows of column A paint red.
    const blue = fills.find((f) => f.style === '#0000ff' && f.x === ROW_HEADER_WIDTH + 1);
    expect(blue).toBeDefined();
    expect(Math.round((blue!.y - COL_HEADER_HEIGHT - 1) / 20)).toBe(2);
    const redRows = fills.filter((f) => f.style === '#ff0000').map((f) => Math.round((f.y - COL_HEADER_HEIGHT - 1) / 20));
    expect(redRows).not.toContain(2);
    expect(redRows.length).toBeGreaterThanOrEqual(3);
  });

  it('renders text of a typed cell with the column default font weight', () => {
    const ctx = installCanvasContext();
    const fonts: string[] = [];
    Object.defineProperty(ctx, 'font', {
      configurable: true,
      get: () => fonts[fonts.length - 1] ?? '',
      set: (v: string) => { fonts.push(v); },
    });
    const callbacks = installAnimationFrames();
    const store = new Store();
    const cm = new CommandManager(store);
    cm.execute.bind(cm)(new SetRangeStyleCommand({ ...wholeColumn(0), style: { bold: true } }));
    store.setCell(1, 0, { text: 'hi', value: 'hi' });

    const renderer = new CanvasRenderer({ canvas: makeCanvas(), store });
    callbacks[0]?.(0);
    renderer.destroy();

    expect(fonts.some((f) => f.startsWith('bold '))).toBe(true);
  });

  it('repaints the column after its default style changes', () => {
    const ctx = installCanvasContext();
    const fills: Fill[] = [];
    (ctx.fillRect as unknown as (x: number, y: number, w: number, h: number) => void) = (x: number, y: number, w: number, h: number): void => {
      fills.push({ style: String(ctx.fillStyle), x, y, w, h });
    };
    const callbacks = installAnimationFrames();
    const store = new Store();
    const renderer = new CanvasRenderer({ canvas: makeCanvas(), store });
    callbacks[0]?.(0);

    const cm = new CommandManager(store);
    cm.execute.bind(cm)(new SetRangeStyleCommand({ ...wholeColumn(2), style: { bgcolor: '#00ff00' } }));
    callbacks[1]?.(0);
    renderer.destroy();

    expect(fills.some((f) => f.style === '#00ff00')).toBe(true);
  });
});
