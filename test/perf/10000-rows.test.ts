import { describe, expect, it } from 'vitest';
import { VirtualScroller } from '../../src/renderer/VirtualScroller';

const ROWS = 10_000;
const COLS = 50;

function createScroller(): VirtualScroller {
  const scroller = new VirtualScroller({
    totalRows: ROWS,
    totalCols: COLS,
    defaultRowHeight: 25,
    defaultColWidth: 100,
    viewportW: 1200,
    viewportH: 800,
  });
  return scroller;
}

describe('Performance: 10000 rows × 50 columns', () => {
  it('computes visible range under 500ms for 10000 rows', () => {
    const scroller = createScroller();
    scroller.setScroll(200_000, 0);

    const start = performance.now();
    for (let i = 0; i < 1000; i += 1) {
      scroller.getVisibleRange();
    }
    const elapsed = performance.now() - start;

    const perCallMs = elapsed / 1000;
    expect(perCallMs).toBeLessThan(0.5);
  });

  it('scroll simulation maintains > 50 effective FPS', () => {
    const scroller = createScroller();
    const frames = 60;
    const scrollStep = 50;

    const start = performance.now();
    for (let i = 0; i < frames; i += 1) {
      scroller.setScroll(i * scrollStep, 0);
      scroller.getVisibleRange();
    }
    const elapsed = performance.now() - start;

    const fps = frames / (elapsed / 1000);
    expect(fps).toBeGreaterThan(50);
  });
});
