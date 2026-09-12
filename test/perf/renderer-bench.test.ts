import { describe, expect, it } from 'vitest';
import { AxisIndex } from '../../src/renderer/AxisIndex';
import { TextMetricsCache } from '../../src/renderer/cache/TextMetricsCache';

describe('Performance: renderer hot paths', () => {
  it('AxisIndex position queries are O(log n) — 100k queries over 100k rows', () => {
    const axis = new AxisIndex(100_000, 25);
    axis.setSize(500, 60);
    axis.setSize(99_999, 0);
    const start = performance.now();
    let acc = 0;
    for (let i = 0; i < 100_000; i += 1) {
      acc += axis.position(i % 100_000);
      acc += axis.indexAt((i * 997) % 2_500_000);
    }
    const elapsed = performance.now() - start;
    expect(acc).toBeGreaterThan(0);
    // Linear scans would take ~10^10 basic ops; this must stay well under 500ms.
    expect(elapsed).toBeLessThan(500);
  });

  it('TextMetricsCache serves repeated measurements from cache', () => {
    const cache = new TextMetricsCache();
    let calls = 0;
    const ctx = { measureText: (t: string) => { calls += 1; return { width: t.length * 7 }; } } as unknown as CanvasRenderingContext2D;
    const font = '11px Calibri';
    for (let i = 0; i < 1000; i += 1) cache.measure(ctx, font, 'hello');
    for (let i = 0; i < 1000; i += 1) cache.measure(ctx, font, `cell-${i % 10}`);
    expect(calls).toBe(11);
    expect(cache.hitRate()).toBeGreaterThan(0.99);
  });
});
