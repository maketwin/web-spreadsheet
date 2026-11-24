import { describe, expect, it, vi } from 'vitest';
import { paintSparklines, SPARKLINE_COLOR, SPARKLINE_LOSS_COLOR, type SparklineDeps } from '../../src/renderer/SparklinePainter';
import { Store } from '../../src/store/Store';
import { VirtualScroller } from '../../src/renderer/VirtualScroller';
import { TOTAL_COLS, TOTAL_ROWS } from '../../src/util/gridSize';

type Ctx = Partial<CanvasRenderingContext2D> & { fillStyleHistory: string[] };

function makeCtx(): Ctx {
  const ctx: Ctx = {
    fillStyleHistory: [],
    save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), clip: vi.fn(), rect: vi.fn(),
    moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), fill: vi.fn(), closePath: vi.fn(), fillRect: vi.fn(),
  };
  Object.defineProperty(ctx, 'fillStyle', { get: () => ctx.fillStyleHistory.at(-1), set: (v: string) => ctx.fillStyleHistory.push(v) });
  return ctx;
}

function makeDeps(): { deps: SparklineDeps; store: Store; ctx: Ctx } {
  const ctx = makeCtx();
  const store = new Store();
  const deps: SparklineDeps = {
    ctx: ctx as unknown as CanvasRenderingContext2D,
    store,
    scroller: new VirtualScroller({ totalRows: TOTAL_ROWS, totalCols: TOTAL_COLS, defaultRowHeight: 20, defaultColWidth: 64, viewportW: 300, viewportH: 150 }),
    cellVP: (r, c) => ({ x: 50 + c * 64, y: 20 + r * 20 }),
  };
  return { deps, store, ctx };
}

const QUADS = [{ r0: 0, r1: TOTAL_ROWS, c0: 0, c1: TOTAL_COLS, clip: { x: 50, y: 20, w: 240, h: 120 } }];

describe('SparklinePainter', () => {
  it('draws a line sparkline as one stroked path', () => {
    const { deps, store, ctx } = makeDeps();
    store.setCell(0, 0, { text: '3', value: 3 });
    store.setCell(0, 1, { text: '1', value: 1 });
    store.setCell(0, 2, { text: '2', value: 2 });
    store.addSparkline({ id: 's1', type: 'line', range: '0,0:0,2', row: 0, col: 5 });
    paintSparklines(deps, QUADS);
    expect(ctx.moveTo).toHaveBeenCalledTimes(1);
    expect(ctx.lineTo).toHaveBeenCalledTimes(2);
    expect(ctx.stroke).toHaveBeenCalledTimes(1);
  });

  it('winloss colors wins blue and losses red, zeros are gaps', () => {
    const { deps, store, ctx } = makeDeps();
    store.setCell(0, 0, { text: '5', value: 5 });
    store.setCell(0, 1, { text: '-2', value: -2 });
    store.setCell(0, 2, { text: '0', value: 0 });
    store.addSparkline({ id: 's1', type: 'winloss', range: '0,0:0,2', row: 0, col: 5 });
    paintSparklines(deps, QUADS);
    expect(ctx.fill).not.toHaveBeenCalled();
    expect(ctx.fillRect).toHaveBeenCalledTimes(2);
    expect(ctx.fillStyleHistory).toEqual([SPARKLINE_COLOR, SPARKLINE_LOSS_COLOR]);
  });

  it('bar sparkline draws one bar per value', () => {
    const { deps, store, ctx } = makeDeps();
    store.setCell(0, 0, { text: '2', value: 2 });
    store.setCell(0, 1, { text: '-1', value: -1 });
    store.setCell(0, 2, { text: '4', value: 4 });
    store.addSparkline({ id: 's1', type: 'bar', range: '0,0:0,2', row: 0, col: 5 });
    paintSparklines(deps, QUADS);
    expect(ctx.fillRect).toHaveBeenCalledTimes(3);
  });

  it('skips sparklines outside the quad window and hidden anchor rows', () => {
    const { deps, store, ctx } = makeDeps();
    store.setCell(0, 0, { text: '1', value: 1 });
    store.setCell(0, 1, { text: '2', value: 2 });
    store.addSparkline({ id: 's1', type: 'line', range: '0,0:0,1', row: 0, col: 5 });
    // Quad covering only column 0..1: anchor col 5 falls outside → nothing drawn.
    paintSparklines(deps, [{ r0: 0, r1: 10, c0: 0, c1: 2, clip: { x: 50, y: 20, w: 100, h: 100 } }]);
    expect(ctx.stroke).not.toHaveBeenCalled();
    // Hidden anchor row → skipped even inside the window.
    const { deps: deps2, store: store2, ctx: ctx2 } = makeDeps();
    store2.setCell(0, 0, { text: '1', value: 1 });
    store2.setCell(0, 1, { text: '2', value: 2 });
    store2.addSparkline({ id: 's1', type: 'line', range: '0,0:0,1', row: 0, col: 5 });
    store2.setRow(0, { hide: true });
    paintSparklines(deps2, QUADS);
    expect(ctx2.stroke).not.toHaveBeenCalled();
  });
});
