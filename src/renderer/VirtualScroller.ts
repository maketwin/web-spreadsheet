import { AxisIndex } from './AxisIndex';

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

/** O(log n) visible-range and coordinate queries backed by prefix-sum indexes. */
export class VirtualScroller {
  private readonly rows: AxisIndex;
  private readonly cols: AxisIndex;
  public scrollTop = 0;
  public scrollLeft = 0;

  public constructor(private opts: VirtualScrollerOptions) {
    this.rows = new AxisIndex(opts.totalRows, opts.defaultRowHeight);
    this.cols = new AxisIndex(opts.totalCols, opts.defaultColWidth);
  }

  public setRowHeight(r: number, h: number): void {
    this.rows.setSize(r, h);
  }

  public setColWidth(c: number, w: number): void {
    this.cols.setSize(c, w);
  }

  public clearRowHeight(r: number): void {
    this.rows.unsetSize(r);
  }

  public clearColWidth(c: number): void {
    this.cols.unsetSize(c);
  }

  public setScroll(top: number, left: number): void {
    this.scrollTop = Math.max(0, top);
    this.scrollLeft = Math.max(0, left);
  }

  public setViewport(w: number, h: number): void {
    this.opts = { ...this.opts, viewportW: w, viewportH: h };
  }

  public getRowHeight(r: number): number {
    return this.rows.getSize(r);
  }

  public getColWidth(c: number): number {
    return this.cols.getSize(c);
  }

  public getVisibleRange(): VisibleRange {
    const rows = this.visibleAxis(this.rows, this.opts.totalRows, this.scrollTop, this.opts.viewportH);
    const cols = this.visibleAxis(this.cols, this.opts.totalCols, this.scrollLeft, this.opts.viewportW);
    return { startRow: rows.start, endRow: rows.end, startCol: cols.start, endCol: cols.end };
  }

  public cellToPixel(r: number, c: number): PixelPosition {
    return { x: this.cols.position(c), y: this.rows.position(r) };
  }

  /** Row whose span contains the grid-space pixel y (clamped). */
  public rowAtPixel(y: number): number {
    return this.rows.indexAt(y);
  }

  /** Column whose span contains the grid-space pixel x (clamped). */
  public colAtPixel(x: number): number {
    return this.cols.indexAt(x);
  }

  public totalHeight(): number {
    return this.rows.total();
  }

  public totalWidth(): number {
    return this.cols.total();
  }

  private visibleAxis(axis: AxisIndex, total: number, scroll: number, viewport: number): { start: number; end: number } {
    if (total <= 0) return { start: 0, end: 0 };
    const start = axis.indexAt(scroll);
    // indexAt clamps, so guard scroll past the content end.
    const startPos = axis.position(start);
    if (startPos + axis.getSize(start) <= scroll && scroll >= axis.total()) return { start: total, end: total };
    const endPixel = scroll + viewport;
    let end = axis.indexAt(Math.max(scroll, endPixel - 1e-9)) + 1;
    if (endPixel >= axis.total()) end = total;
    if (end > total) end = total;
    return { start, end };
  }
}
