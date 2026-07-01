export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class DirtyRegionTracker {
  private regions: Rect[] = [];

  public invalidate(rect: Rect): void {
    const normalized = { ...rect };
    let index = 0;

    while (index < this.regions.length) {
      const current = this.regions[index];
      if (current === undefined || !this.touchesOrOverlaps(current, normalized)) {
        index += 1;
        continue;
      }

      this.regions.splice(index, 1);
      this.mergeInto(normalized, current);
    }

    this.regions.push(normalized);
  }

  public invalidateAll(): void {
    this.regions = [{ x: 0, y: 0, w: Number.MAX_SAFE_INTEGER, h: Number.MAX_SAFE_INTEGER }];
  }

  public drain(): Rect[] {
    const out = this.regions;
    this.regions = [];
    return out;
  }

  public isEmpty(): boolean {
    return this.regions.length === 0;
  }

  private mergeInto(target: Rect, source: Rect): void {
    const minX = Math.min(target.x, source.x);
    const minY = Math.min(target.y, source.y);
    const maxX = Math.max(target.x + target.w, source.x + source.w);
    const maxY = Math.max(target.y + target.h, source.y + source.h);

    target.x = minX;
    target.y = minY;
    target.w = maxX - minX;
    target.h = maxY - minY;
  }

  private touchesOrOverlaps(a: Rect, b: Rect): boolean {
    return !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y);
  }
}
