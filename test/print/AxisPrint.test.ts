import { afterEach, describe, expect, it, vi } from 'vitest';
import { PrintPainter } from '../../src/print/PrintPainter';
import { DEFAULT_PRINT_SETTINGS } from '../../src/print/types';
import { SetRangeStyleCommand } from '../../src/commands/impl/SetRangeStyle';
import { CommandManager } from '../../src/commands/CommandManager';
import { Store } from '../../src/store/Store';
import { TOTAL_COLS, TOTAL_ROWS } from '../../src/util/gridSize';

/** jsdom has no canvas implementation — stub the 2D context (PrintPainter.test pattern). */
function installCanvasContext(): { ctx: Record<string, unknown>; fillStyles: string[] } {
  const fillStyles: string[] = [];
  const ctx: Record<string, unknown> = {
    beginPath: vi.fn(),
    clip: vi.fn(),
    drawImage: vi.fn(),
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

describe('PrintPainter axis default styles', () => {
  it('paints the column default fill on cells without their own style', () => {
    const { fillStyles } = installCanvasContext();
    const store = new Store();
    const cm = new CommandManager(store);
    cm.execute.bind(cm)(new SetRangeStyleCommand({ r1: 0, c1: 0, r2: TOTAL_ROWS - 1, c2: 0, style: { bgcolor: '#00ffff' } }));
    store.setCell(5, 1, { text: 'other column' });

    const painter = new PrintPainter(store, store.getActiveSheetId());
    painter.paint({ index: 0, colStart: 0, colEnd: 1, rowStart: 0, rowEnd: 9 }, 1, DEFAULT_PRINT_SETTINGS);

    // One fill per printed row of column A plus the white background — the
    // empty rows inherit the axis default exactly like a styled cell would.
    const axisFills = fillStyles.filter((s) => s === '#00ffff');
    expect(axisFills.length).toBe(10);
  });

  it('the row default wins over the column default on the crossing cell', () => {
    const { fillStyles } = installCanvasContext();
    const store = new Store();
    const cm = new CommandManager(store);
    cm.execute.bind(cm)(new SetRangeStyleCommand({ r1: 0, c1: 0, r2: TOTAL_ROWS - 1, c2: 0, style: { bgcolor: '#ff0000' } }));
    cm.execute.bind(cm)(new SetRangeStyleCommand({ r1: 2, c1: 0, r2: 2, c2: TOTAL_COLS - 1, style: { bgcolor: '#0000ff' } }));

    const painter = new PrintPainter(store, store.getActiveSheetId());
    painter.paint({ index: 0, colStart: 0, colEnd: 0, rowStart: 0, rowEnd: 4 }, 1, DEFAULT_PRINT_SETTINGS);

    expect(fillStyles.filter((s) => s === '#0000ff').length).toBe(1); // row 3 only
    expect(fillStyles.filter((s) => s === '#ff0000').length).toBe(4); // the other four rows
  });
});
