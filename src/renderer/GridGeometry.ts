import type { Store } from '../store/Store';
import type { FreezeManager } from '../freeze/FreezeManager';
import type { RangeAddress } from '../selection/Range';
import type { ChartAnchor } from '../charts/types';
import { anchorToRect, rectToAnchor } from '../charts/geometry';
import { TOTAL_ROWS, TOTAL_COLS, ROW_HEIGHT, ROW_HEADER_WIDTH, COL_HEADER_HEIGHT, clamp, type CellAddress, type HeaderHit } from './coordinate';
import type { VirtualScroller } from './VirtualScroller';
import type { Rect } from './DirtyRegionTracker';

/**
 * Stateless hit-testing and coordinate math for the grid canvas: the
 * freeze-quadrant cell-position model (cellVP), pointer→cell/column/row
 * resolution, viewport rects, and chart-anchor conversion. Extracted from
 * CanvasRenderer — the renderer delegates here and keeps its public surface
 * as one-line wrappers. All scroll state lives in the injected VirtualScroller;
 * scrolling side effects (scrollCellIntoView) come back through the injected
 * scrollBy callback so the renderer keeps its blit-accelerated scroll path.
 */

export interface GridGeometryOptions {
  readonly canvas: HTMLCanvasElement;
  readonly scroller: VirtualScroller;
  readonly freeze: FreezeManager;
  /** Merge lookup for viewport rects (the editor overlay covers whole merged areas). */
  readonly store: Store;
  zoom(): number;
  gridW(): number;
  gridH(): number;
  vpW(): number;
  vpH(): number;
  scrollBy(dx: number, dy: number): void;
}

export class GridGeometry {
  /** Ranges wider/taller than this answer their pixel size from the axis prefix
   * sums instead of a per-cell sum (identical for whole-pixel sizes; a per-cell
   * walk would reach 16,384 columns / 1,048,576 rows for whole-row/column/sheet
   * selections, several times per painted frame). */
  private static readonly DIRECT_SUM_LIMIT = 512;

  public constructor(private readonly o: GridGeometryOptions) {}

  public rangeRect(range: RangeAddress): { x: number; y: number; w: number; h: number } {
    const { x, y } = this.cellVP(range.r1, range.c1);
    const w = range.c2 - range.c1 >= GridGeometry.DIRECT_SUM_LIMIT
      ? this.o.scroller.colWidthSpan(range.c1, range.c2)
      : this.sumAxisSizes(range.c1, range.c2, (c) => this.o.scroller.getColWidth(c));
    const h = range.r2 - range.r1 >= GridGeometry.DIRECT_SUM_LIMIT
      ? this.o.scroller.rowHeightSpan(range.r1, range.r2)
      : this.sumAxisSizes(range.r1, range.r2, (r) => this.o.scroller.getRowHeight(r));
    return { x, y, w, h };
  }

  /** Exact per-index sum, as rangeRect always computed it for small ranges. */
  private sumAxisSizes(from: number, to: number, sizeAt: (i: number) => number): number {
    let acc = 0;
    for (let i = from; i <= to; i += 1) acc += sizeAt(i);
    return acc;
  }

  public pointerCell(cx: number, cy: number): CellAddress | null {
    const rect = this.o.canvas.getBoundingClientRect();
    const gx = cx - rect.left - ROW_HEADER_WIDTH;
    const gy = cy - rect.top - COL_HEADER_HEIGHT;
    if (gx < 0 || gy < 0) return null;
    // Past the scrollable content end (and not inside a frozen strip) — no cell.
    if (gx >= this.frozenW() && gx + this.o.scroller.scrollLeft >= this.o.scroller.totalWidth()) return null;
    if (gy >= this.frozenH() && gy + this.o.scroller.scrollTop >= this.o.scroller.totalHeight()) return null;
    return { r: this.rowAtViewportY(cy - rect.top) as number, c: this.colAtViewportX(cx - rect.left) as number };
  }

  /** Viewport rect of a cell (includes scroll) — use this for the editor overlay so it matches canvas geometry. */
  public getCellViewportRect(r: number, c: number): { x: number; y: number; w: number; h: number } {
    // Excel: the in-cell editor covers the whole merged area, not just the anchor cell.
    const merge = this.o.store.getMergeRectAt(r, c);
    if (merge !== undefined) return this.rangeRect(merge);
    const { x, y } = this.cellVP(r, c);
    return { x, y, w: this.o.scroller.getColWidth(c), h: this.o.scroller.getRowHeight(r) };
  }

  /** Scroll the sheet so the cell is fully visible inside the grid area.
   * `visibleHeight` limits the usable grid height — pass the soft-keyboard-
   * reduced visual viewport height so the editing cell lands ABOVE the
   * keyboard (Excel mobile). Frozen-region cells are already on screen and
   * never trigger scrolling. */
  public scrollCellIntoView(r: number, c: number, visibleHeight?: number): void {
    const { x, y } = this.cellVP(r, c);
    const w = this.o.scroller.getColWidth(c);
    const h = this.o.scroller.getRowHeight(r);
    const usableH = Math.max(ROW_HEIGHT, Math.min(this.o.gridH(), visibleHeight ?? this.o.gridH()));
    let dy = 0;
    if (y < COL_HEADER_HEIGHT) dy = y - COL_HEADER_HEIGHT;
    else if (y + h > COL_HEADER_HEIGHT + usableH) dy = y + h - (COL_HEADER_HEIGHT + usableH);
    let dx = 0;
    if (x < ROW_HEADER_WIDTH) dx = x - ROW_HEADER_WIDTH;
    else if (x + w > ROW_HEADER_WIDTH + this.o.gridW()) dx = x + w - (ROW_HEADER_WIDTH + this.o.gridW());
    if (dy !== 0 || dx !== 0) this.o.scrollBy(dx, dy);
  }

  /** Floating chart-object rect for a two-cell anchor (canvas-space px, freeze/scroll/zoom aware). */
  public chartRect(anchor: ChartAnchor): Rect {
    return anchorToRect(this.o.scroller, this.o.zoom(), this.o.freeze.getFrozenRows(), this.o.freeze.getFrozenCols(), anchor);
  }

  /** Inverse of chartRect: snap a canvas-space rect back to a two-cell anchor. */
  public anchorFromRect(rect: { x: number; y: number; w: number; h: number }): ChartAnchor {
    return rectToAnchor(this.o.scroller, this.o.zoom(), this.o.freeze.getFrozenRows(), this.o.freeze.getFrozenCols(), rect);
  }

  /** Visible grid client area (canvas space, headers excluded) — used to place/clip floating objects. */
  public gridClientRect(): Rect {
    return { x: ROW_HEADER_WIDTH, y: COL_HEADER_HEIGHT, w: this.o.gridW(), h: this.o.gridH() };
  }

  public columnAtPoint(clientX: number): number | null {
    const rect = this.o.canvas.getBoundingClientRect();
    return this.colAtViewportX(clientX - rect.left);
  }

  public rowAtPoint(clientY: number): number | null {
    const rect = this.o.canvas.getBoundingClientRect();
    return this.rowAtViewportY(clientY - rect.top);
  }

  public headerAtPoint(clientX: number, clientY: number): HeaderHit {
    const rect = this.o.canvas.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    const inRowHeader = mx >= 0 && mx < ROW_HEADER_WIDTH;
    const inColHeader = my >= 0 && my < COL_HEADER_HEIGHT;
    if (inRowHeader && inColHeader) return { type: 'sheet' };
    if (inColHeader) { const c = this.columnAtPoint(clientX); return c === null ? null : { type: 'column', c }; }
    if (inRowHeader) { const r = this.rowAtPoint(clientY); return r === null ? null : { type: 'row', r }; }
    return null;
  }

  /** Freeze-aware viewport position of a cell. Frozen rows/cols keep their
   * unscrolled position; scrollable content slides underneath the frozen strips
   * and is clipped at the freeze line (Excel quadrant model). */
  public cellVP(r: number, c: number): { x: number; y: number } {
    const p = this.o.scroller.cellToPixel(r, c);
    const fc = this.o.freeze.getFrozenCols();
    const fr = this.o.freeze.getFrozenRows();
    const fw = this.frozenW();
    const fh = this.frozenH();
    // Excel quadrants: frozen bands stay pinned; the unfrozen pane is positioned so that
    // content (fw, fh) sits at the freeze corner when scroll is 0, then slides under on scroll.
    const x = c < fc
      ? ROW_HEADER_WIDTH + p.x
      : ROW_HEADER_WIDTH + fw + (p.x - fw - this.o.scroller.scrollLeft);
    const y = r < fr
      ? COL_HEADER_HEIGHT + p.y
      : COL_HEADER_HEIGHT + fh + (p.y - fh - this.o.scroller.scrollTop);
    return { x, y };
  }

  /** Pixel width of the frozen column strip (prefix sum of frozen col widths). */
  public frozenW(): number { const fc = this.o.freeze.getFrozenCols(); return fc === 0 ? 0 : this.o.scroller.cellToPixel(0, fc).x; }
  /** Pixel height of the frozen row strip. */
  public frozenH(): number { const fr = this.o.freeze.getFrozenRows(); return fr === 0 ? 0 : this.o.scroller.cellToPixel(fr, 0).y; }

  /** Intersect a dirty rect with the canvas CSS box (avoids huge clip rects from invalidateAll). */
  public clampToViewport(region: Rect): Rect {
    const x = Math.max(0, region.x);
    const y = Math.max(0, region.y);
    const w = Math.min(region.x + region.w, this.o.vpW()) - x;
    const h = Math.min(region.y + region.h, this.o.vpH()) - y;
    return { x, y, w: Math.max(0, w), h: Math.max(0, h) };
  }

  /** Viewport x -> column index, or null left of the grid. Points inside the frozen
   * strip map without scroll; scrollable points add the scroll offset. */
  public colAtViewportX(px: number): number | null {
    const gx = px - ROW_HEADER_WIDTH;
    if (gx < 0) return null;
    const fw = this.frozenW();
    // Frozen strip: un-scrolled columns 0..fc-1
    if (gx < fw) return this.o.scroller.colAtPixel(gx);
    // Scrollable pane: Excel origin is the freeze edge; content x = fw + scrollLeft + local
    const content = fw + this.o.scroller.scrollLeft + (gx - fw);
    return content >= this.o.scroller.totalWidth() ? TOTAL_COLS - 1 : this.o.scroller.colAtPixel(content);
  }

  /** Viewport y -> row index, or null above the grid. Points inside the frozen
   * strip map without scroll; scrollable points add the scroll offset. */
  public rowAtViewportY(py: number): number | null {
    const gy = py - COL_HEADER_HEIGHT;
    if (gy < 0) return null;
    const fh = this.frozenH();
    if (gy < fh) return this.o.scroller.rowAtPixel(gy);
    const content = fh + this.o.scroller.scrollTop + (gy - fh);
    return content >= this.o.scroller.totalHeight() ? TOTAL_ROWS - 1 : this.o.scroller.rowAtPixel(content);
  }

  public rectsIntersect(x: number, y: number, w: number, h: number, clip: Rect): boolean {
    return x < clip.x + clip.w && x + w > clip.x && y < clip.y + clip.h && y + h > clip.y;
  }

  /** Excel: a move never crosses the freeze boundary — the target stays in the
   * source's own region (frozen band or scrollable area) on each axis. A range
   * straddling the boundary pins to its anchor, disabling the move. */
  public moveTargetFromPointer(drag: { source: RangeAddress; offset: CellAddress }, pointer: CellAddress): CellAddress {
    const rows = drag.source.r2 - drag.source.r1 + 1;
    const cols = drag.source.c2 - drag.source.c1 + 1;
    let minR = 0;
    let maxR = TOTAL_ROWS - rows;
    if (drag.source.r2 < this.o.freeze.getFrozenRows()) maxR = this.o.freeze.getFrozenRows() - rows;
    else if (drag.source.r1 < this.o.freeze.getFrozenRows()) { minR = drag.source.r1; maxR = drag.source.r1; }
    else minR = this.o.freeze.getFrozenRows();
    let minC = 0;
    let maxC = TOTAL_COLS - cols;
    if (drag.source.c2 < this.o.freeze.getFrozenCols()) maxC = this.o.freeze.getFrozenCols() - cols;
    else if (drag.source.c1 < this.o.freeze.getFrozenCols()) { minC = drag.source.c1; maxC = drag.source.c1; }
    else minC = this.o.freeze.getFrozenCols();
    return {
      r: clamp(pointer.r - drag.offset.r, minR, Math.max(minR, maxR)),
      c: clamp(pointer.c - drag.offset.c, minC, Math.max(minC, maxC)),
    };
  }
}
