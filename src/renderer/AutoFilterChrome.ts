import type { Store } from '../store/Store';
import type { FreezeManager } from '../freeze/FreezeManager';
import type { VirtualScroller, VisibleRange } from './VirtualScroller';
import { COL_HEADER_HEIGHT, ROW_HEADER_WIDTH, cssHeaderText, type CanvasTheme, type CellAddress } from './coordinate';

/**
 * AutoFilter header-row chrome: the in-cell dropdown/funnel icon Excel draws
 * inside each filter-range header cell, the blue row numbers while criteria
 * hide rows, and the hit-test that turns a click on the icon into an
 * onAutoFilterClick callback. Extracted from CanvasRenderer — geometry access
 * is injected (same pattern as ResizeHandler/FillHandle).
 */

/** Width of the in-cell dropdown button (px, unzoomed). */
export const AUTO_FILTER_BUTTON_WIDTH = 16;

/** Excel paints filtered-out row numbers blue while criteria hide rows. */
const FILTERED_ROW_NUMBER_COLOR = '#0057C2';

/** Geometry/data access shared by the paint and hit-test functions. */
export interface AutoFilterChromeDeps {
  readonly ctx: CanvasRenderingContext2D;
  readonly store: Store;
  readonly canvas: HTMLCanvasElement;
  readonly scroller: VirtualScroller;
  readonly freeze: FreezeManager;
  cellVP(r: number, c: number): { x: number; y: number };
  frozenW(): number;
  frozenH(): number;
  vpW(): number;
  vpH(): number;
  pointerCell(clientX: number, clientY: number): CellAddress | null;
}

/** Excel paints visible row numbers blue inside the AutoFilter range while criteria hide rows. */
export function filteredRowNumberColor(store: Store, r: number, theme: CanvasTheme): string {
  const filter = store.getAutoFilter();
  if (filter === undefined || Object.keys(filter.criteria).length === 0) return cssHeaderText(theme);
  return r > filter.range.r1 && r <= filter.range.r2 ? FILTERED_ROW_NUMBER_COLOR : cssHeaderText(theme);
}

export function paintAutoFilterIcons(deps: AutoFilterChromeDeps, vis: VisibleRange, theme: CanvasTheme): void {
  const filter = deps.store.getAutoFilter();
  if (filter === undefined) return;
  // Excel draws the dropdown button inside each header-row cell, not on
  // the column-letter header.
  const headerRow = filter.range.r1;
  const fr = deps.freeze.getFrozenRows();
  const fc = deps.freeze.getFrozenCols();
  const fw = deps.frozenW();
  const fh = deps.frozenH();
  const frozenVisible = headerRow < fr;
  if (!frozenVisible && (headerRow < vis.startRow || headerRow >= vis.endRow)) return;
  // Icons live inside cells, so each icon clips to its cell's quadrant: a header
  // row/column sliding under a frozen strip must not bleed its icon over pinned cells.
  const quadY = frozenVisible ? COL_HEADER_HEIGHT : COL_HEADER_HEIGHT + fh;
  const quadH = frozenVisible ? fh : deps.vpH() - COL_HEADER_HEIGHT - fh;
  const rowHeight = deps.scroller.getRowHeight(headerRow);
  const { y } = deps.cellVP(headerRow, filter.range.c1);
  const first = Math.max(vis.startCol, filter.range.c1);
  const last = Math.min(vis.endCol - 1, filter.range.c2);
  for (let c = first; c <= last; c += 1) {
    const { x } = deps.cellVP(headerRow, c);
    const w = deps.scroller.getColWidth(c);
    const active = filter.criteria[c] !== undefined;
    deps.ctx.save();
    deps.ctx.beginPath();
    deps.ctx.rect(c < fc ? ROW_HEADER_WIDTH : ROW_HEADER_WIDTH + fw, quadY, c < fc ? fw : deps.vpW() - ROW_HEADER_WIDTH - fw, quadH);
    deps.ctx.clip();
    paintAutoFilterIcon(deps.ctx, x + w - AUTO_FILTER_BUTTON_WIDTH - 4, y + rowHeight / 2, theme, active);
    deps.ctx.restore();
  }
}

export function paintAutoFilterIcon(ctx: CanvasRenderingContext2D, x: number, y: number, theme: CanvasTheme, active: boolean): void {
  ctx.save();
  ctx.fillStyle = active ? theme.accent : cssHeaderText(theme);
  ctx.strokeStyle = ctx.fillStyle;
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (active) {
    // Excel's active funnel icon
    const left = x + 2;
    const right = x + AUTO_FILTER_BUTTON_WIDTH - 2;
    const top = y - 5;
    const bottom = y + 6;
    ctx.moveTo(left, top); ctx.lineTo(right, top);
    ctx.lineTo(x + AUTO_FILTER_BUTTON_WIDTH / 2 + 1, y + 1);
    ctx.lineTo(x + AUTO_FILTER_BUTTON_WIDTH / 2 + 1, bottom);
    ctx.lineTo(x + AUTO_FILTER_BUTTON_WIDTH / 2 - 1, bottom - 1);
    ctx.lineTo(x + AUTO_FILTER_BUTTON_WIDTH / 2 - 1, y + 1);
    ctx.closePath();
    ctx.fill();
  } else {
    // Excel's idle dropdown chevron
    ctx.moveTo(x + 4, y - 2);
    ctx.lineTo(x + AUTO_FILTER_BUTTON_WIDTH / 2, y + 3);
    ctx.lineTo(x + AUTO_FILTER_BUTTON_WIDTH - 4, y - 2);
    ctx.stroke();
  }
  ctx.restore();
}

/** The header cell whose filter button contains the point, if any. */
export function autoFilterAtPoint(deps: AutoFilterChromeDeps, clientX: number, clientY: number): CellAddress | null {
  const filter = deps.store.getAutoFilter();
  if (filter === undefined) return null;
  const cell = deps.pointerCell(clientX, clientY);
  if (cell === null || cell.r !== filter.range.r1) return null;
  if (cell.c < filter.range.c1 || cell.c > filter.range.c2) return null;
  const { x } = deps.cellVP(cell.r, cell.c);
  const w = deps.scroller.getColWidth(cell.c);
  const px = clientX - deps.canvas.getBoundingClientRect().left;
  return px >= x + w - AUTO_FILTER_BUTTON_WIDTH - 6 && px <= x + w - 2 ? cell : null;
}
