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
    const width = typeof ctx.measureText === 'function' ? ctx.measureText(text).width : text.length * 8;
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
