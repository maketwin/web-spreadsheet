/** Prefix-sum index over per-index sizes with O(log n) position queries.
 *
 * The grid may have 10k+ rows; linear scans in the hot paint path cost
 * O(n) per query and are called once per visible cell per frame. This
 * index caches prefix sums and answers both directions via binary search:
 *   - position(index) -> pixel offset (prefix sum)
 *   - indexAt(pixel)  -> index containing the offset
 *
 * Rebuilds lazily after any size mutation.
 */
export class AxisIndex {
  private sizes: Float64Array;
  private prefix: Float64Array | null = null;
  private readonly defaultSize: () => number;

  public constructor(private count: number, defaultSize: number) {
    this.sizes = new Float64Array(count);
    this.defaultSize = () => defaultSize;
    // NaN marks "unset" so 0-height hidden rows stay distinguishable from default.
    this.sizes.fill(Number.NaN);
  }

  public setCount(count: number): void {
    if (count === this.count) return;
    const next = new Float64Array(count);
    next.set(this.sizes.subarray(0, Math.min(this.count, count)));
    if (count > this.count) next.fill(Number.NaN, this.count);
    this.sizes = next;
    this.count = count;
    this.prefix = null;
  }

  public setSize(index: number, size: number): void {
    if (index < 0 || index >= this.count) return;
    if (this.sizes[index] === size) return;
    this.sizes[index] = size;
    this.prefix = null;
  }

  public unsetSize(index: number): void {
    this.setSize(index, Number.NaN);
  }

  public getSize(index: number): number {
    const v = this.sizes[index];
    return v === undefined || Number.isNaN(v) ? this.defaultSize() : v;
  }

  /** Pixel offset of the start of `index`. O(log n) amortized. */
  public position(index: number): number {
    if (index <= 0) return 0;
    const p = this.ensurePrefix();
    return index >= this.count ? p[this.count]! : p[index]!;
  }

  /** Total pixel extent of the whole axis. */
  public total(): number {
    return this.ensurePrefix()[this.count]!;
  }

  /** Index whose span contains `pixel`; clamps to [0, count-1] for in-range pixels. */
  public indexAt(pixel: number): number {
    if (pixel <= 0) return 0;
    const p = this.ensurePrefix();
    if (pixel >= p[this.count]!) return this.count - 1;
    // First index i with prefix[i+1] > pixel.
    let lo = 0;
    let hi = this.count - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (p[mid + 1]! > pixel) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  }

  private ensurePrefix(): Float64Array {
    if (this.prefix !== null) return this.prefix;
    const p = new Float64Array(this.count + 1);
    const d = this.defaultSize();
    let acc = 0;
    for (let i = 0; i < this.count; i += 1) {
      const v = this.sizes[i]!;
      acc += Number.isNaN(v) ? d : v;
      p[i + 1] = acc;
    }
    this.prefix = p;
    return p;
  }
}
