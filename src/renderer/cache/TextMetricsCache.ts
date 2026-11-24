/** LRU cache for CanvasRenderingContext2D.measureText results.
 *
 * Text measurement is one of the most expensive per-cell operations in the
 * paint path (and is quadratic-ish inside word wrap). Keys are `font|text`;
 * entries are evicted oldest-first beyond capacity.
 */
export class TextMetricsCache {
  private readonly cache = new Map<string, number>();
  private hits = 0;
  private misses = 0;

  public constructor(private readonly capacity = 5000) {}

  public measure(ctx: CanvasRenderingContext2D, font: string, text: string): number {
    const key = `${font}|${text}`;
    const hit = this.cache.get(key);
    if (hit !== undefined) {
      this.hits += 1;
      // Refresh recency.
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit;
    }
    this.misses += 1;
    let width: number;
    if (typeof ctx.measureText !== 'function') {
      width = text.length * 8;
    } else {
      // Measure with the requested font, not whatever the canvas happens to
      // carry: rich-text runs measure in their own font before the painter
      // sets `ctx.font` per segment (the plain paths pass the font they just
      // set, so the swap is a no-op for them). Restore afterwards so callers
      // never observe the swap; cache hits never touch the context at all.
      const previousFont = ctx.font;
      const fontChanged = previousFont !== font;
      if (fontChanged) ctx.font = font;
      width = ctx.measureText(text).width;
      if (fontChanged) ctx.font = previousFont;
    }
    this.cache.set(key, width);
    if (this.cache.size > this.capacity) {
      const oldest = this.cache.keys().next();
      if (oldest.done !== true) this.cache.delete(oldest.value);
    }
    return width;
  }

  public clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /** Test/diagnostic: cache hit ratio since last clear. */
  public hitRate(): number {
    const total = this.hits + this.misses;
    return total === 0 ? 0 : this.hits / total;
  }
}
