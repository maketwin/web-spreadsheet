import { describe, expect, it, vi } from 'vitest';
import { TextMetricsCache } from '../../src/renderer/cache/TextMetricsCache';

/** A 2D-context stub that records `ctx.font` at every measureText call. */
interface RecordingCtx { font: string; measureText(text: string): TextMetrics }
function makeRecordingCtx(initialFont: string): {
  ctx: CanvasRenderingContext2D;
  fontAtMeasure: string[];
} {
  const fontAtMeasure: string[] = [];
  const ctx: RecordingCtx = {
    font: initialFont,
    measureText(text: string): TextMetrics {
      fontAtMeasure.push(ctx.font);
      return { width: text.length * 10 } as TextMetrics;
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, fontAtMeasure };
}

describe('TextMetricsCache.measure', () => {
  it('measures with the requested font and restores the previous one', () => {
    const { ctx, fontAtMeasure } = makeRecordingCtx('12px Arial');

    const width = ctx.measureText === undefined ? 0 : new TextMetricsCache().measure(ctx, 'bold 20px "Comic Sans MS"', 'ab');

    expect(width).toBe(20);
    expect(fontAtMeasure).toEqual(['bold 20px "Comic Sans MS"']);
    expect(ctx.font).toBe('12px Arial');
  });

  it('does not touch ctx.font when the requested font is already set', () => {
    const { ctx, fontAtMeasure } = makeRecordingCtx('italic 14px Georgia');

    new TextMetricsCache().measure(ctx, 'italic 14px Georgia', 'xyz');

    expect(fontAtMeasure).toEqual(['italic 14px Georgia']);
    expect(ctx.font).toBe('italic 14px Georgia');
  });

  it('serves repeat measurements from cache without calling measureText or touching ctx.font', () => {
    const { ctx, fontAtMeasure } = makeRecordingCtx('12px Arial');
    const cache = new TextMetricsCache();
    const width = cache.measure(ctx, 'bold 16px Arial', 'hello');

    // The painter changed the canvas font since the miss — a hit must not swap it.
    ctx.font = '40px Later';
    expect(cache.measure(ctx, 'bold 16px Arial', 'hello')).toBe(width);

    expect(fontAtMeasure).toEqual(['bold 16px Arial']);
    expect(ctx.font).toBe('40px Later');
    expect(cache.hitRate()).toBe(0.5);
  });

  it('keeps fonts apart: same text under two fonts measures twice, each with its own font', () => {
    const { ctx, fontAtMeasure } = makeRecordingCtx('10px Base');
    const cache = new TextMetricsCache();

    cache.measure(ctx, 'bold 30px A', 'W');
    cache.measure(ctx, 'italic 12px B', 'W');

    expect(fontAtMeasure).toEqual(['bold 30px A', 'italic 12px B']);
    expect(ctx.font).toBe('10px Base');
    expect(cache.hitRate()).toBe(0);
  });

  it('falls back to text.length * 8 without a measureText (no font swap attempted)', () => {
    const ctx = {} as CanvasRenderingContext2D;

    expect(new TextMetricsCache().measure(ctx, '11px Calibri', 'abcd')).toBe(32);
  });

  it('clear resets hits and misses', () => {
    const { ctx } = makeRecordingCtx('12px Arial');
    const cache = new TextMetricsCache();
    cache.measure(ctx, 'f', 't');
    cache.measure(ctx, 'f', 't');

    cache.clear();

    expect(cache.hitRate()).toBe(0);
  });

  it('evicts the oldest entry beyond capacity', () => {
    const measureText = vi.fn((_text: string) => ({ width: 1 } as TextMetrics));
    const ctx = { font: 'f', measureText } as unknown as CanvasRenderingContext2D;
    const cache = new TextMetricsCache(2);

    cache.measure(ctx, 'f', 'a');
    cache.measure(ctx, 'f', 'b');
    cache.measure(ctx, 'f', 'c'); // evicts 'a'
    cache.measure(ctx, 'f', 'b'); // hit
    cache.measure(ctx, 'f', 'a'); // miss again

    expect(measureText).toHaveBeenCalledTimes(4);
  });
});
