export interface VirtualScrollerOptions {
  totalRows: number;
  totalCols: number;
  defaultRowHeight: number;
  defaultColWidth: number;
  viewportW: number;
  viewportH: number;
}

export interface VisibleRange {
  startRow: number;
  endRow: number;
  startCol: number;
  endCol: number;
}

export interface PixelPosition {
  x: number;
  y: number;
}

export class VirtualScroller {
  private rowHeights = new Map<number, number>();
  private colWidths = new Map<number, number>();
  public scrollTop = 0;
  public scrollLeft = 0;

  public constructor(private opts: VirtualScrollerOptions) {}

  public setRowHeight(r: number, h: number): void {
    this.rowHeights.set(r, h);
  }

  public setColWidth(c: number, w: number): void {
    this.colWidths.set(c, w);
  }

  public setScroll(top: number, left: number): void {
    this.scrollTop = Math.max(0, top);
    this.scrollLeft = Math.max(0, left);
  }

  public setViewport(w: number, h: number): void {
    this.opts = { ...this.opts, viewportW: w, viewportH: h };
  }

  public getRowHeight(r: number): number {
    return this.rowHeights.get(r) ?? this.opts.defaultRowHeight;
  }

  public getColWidth(c: number): number {
    return this.colWidths.get(c) ?? this.opts.defaultColWidth;
  }

  public getVisibleRange(): VisibleRange {
    const rows = this.getVisibleAxis(
      this.opts.totalRows,
      this.scrollTop,
      this.opts.viewportH,
      (index) => this.getRowHeight(index),
    );
    const cols = this.getVisibleAxis(
      this.opts.totalCols,
      this.scrollLeft,
      this.opts.viewportW,
      (index) => this.getColWidth(index),
    );
    return { startRow: rows.start, endRow: rows.end, startCol: cols.start, endCol: cols.end };
  }

  public cellToPixel(r: number, c: number): PixelPosition {
    let y = 0;
    for (let i = 0; i < r; i += 1) y += this.getRowHeight(i);

    let x = 0;
    for (let i = 0; i < c; i += 1) x += this.getColWidth(i);

    return { x, y };
  }

  private getVisibleAxis(
    total: number,
    scroll: number,
    viewport: number,
    getSize: (index: number) => number,
  ): { start: number; end: number } {
    let start = 0;
    let offset = 0;
    while (start < total && offset + getSize(start) <= scroll) {
      offset += getSize(start);
      start += 1;
    }

    let end = start;
    let extent = offset;
    while (end < total && extent < scroll + viewport) {
      extent += getSize(end);
      end += 1;
    }

    return { start, end };
  }
}
