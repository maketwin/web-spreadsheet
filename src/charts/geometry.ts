import { COL_HEADER_HEIGHT, ROW_HEADER_WIDTH } from '../renderer/coordinate';
import type { ChartAnchor, ChartAnchorEdge } from './types';

/**
 * Anchor ↔ viewport-rect math for floating chart objects, mirroring the
 * renderer's freeze-aware quadrant model (CanvasRenderer.cellVP). Kept pure
 * over a minimal scroller interface so it is unit-testable without a canvas.
 */
export interface ChartGeometrySource {
  /** Content-space (zoomed px) origin of a cell. */
  cellToPixel(r: number, c: number): { x: number; y: number };
  getRowHeight(r: number): number;
  getColWidth(c: number): number;
  rowAtPixel(y: number): number;
  colAtPixel(x: number): number;
  scrollTop: number;
  scrollLeft: number;
}

export interface ViewportRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Viewport px of one anchor edge (canvas space, row/col headers included). */
function edgeToViewport(
  g: ChartGeometrySource,
  zoom: number,
  frozenRows: number,
  frozenCols: number,
  edge: ChartAnchorEdge,
): { x: number; y: number } {
  const p = g.cellToPixel(edge.r, edge.c);
  const fw = frozenCols === 0 ? 0 : g.cellToPixel(0, frozenCols).x;
  const fh = frozenRows === 0 ? 0 : g.cellToPixel(frozenRows, 0).y;
  const x = edge.c < frozenCols
    ? ROW_HEADER_WIDTH + p.x + edge.offX * zoom
    : ROW_HEADER_WIDTH + fw + (p.x + edge.offX * zoom - fw - g.scrollLeft);
  const y = edge.r < frozenRows
    ? COL_HEADER_HEIGHT + p.y + edge.offY * zoom
    : COL_HEADER_HEIGHT + fh + (p.y + edge.offY * zoom - fh - g.scrollTop);
  return { x, y };
}

/** Viewport px → (content px, offset inside the containing cell). */
function viewportToContent(
  g: ChartGeometrySource,
  frozenRows: number,
  frozenCols: number,
  axis: 'x' | 'y',
  viewportPx: number,
): { index: number; offset: number } {
  const isX = axis === 'x';
  const headerSize = isX ? ROW_HEADER_WIDTH : COL_HEADER_HEIGHT;
  const frozenCount = isX ? frozenCols : frozenRows;
  const frozenSize = frozenCount === 0
    ? 0
    : isX
      ? g.cellToPixel(0, frozenCount).x
      : g.cellToPixel(frozenCount, 0).y;
  const local = viewportPx - headerSize;
  const content = local < frozenSize
    ? local
    : frozenSize + (isX ? g.scrollLeft : g.scrollTop) + (local - frozenSize);
  const index = isX ? g.colAtPixel(content) : g.rowAtPixel(content);
  // cellToPixel takes (row, col): the x origin reads the column, the y origin the row.
  const origin = isX ? g.cellToPixel(0, index).x : g.cellToPixel(index, 0).y;
  return { index, offset: content - origin };
}

/** Floating object's on-screen rect (canvas-space px) for an anchor. */
export function anchorToRect(
  g: ChartGeometrySource,
  zoom: number,
  frozenRows: number,
  frozenCols: number,
  anchor: ChartAnchor,
): ViewportRect {
  const a = edgeToViewport(g, zoom, frozenRows, frozenCols, anchor.from);
  const b = edgeToViewport(g, zoom, frozenRows, frozenCols, anchor.to);
  return { x: a.x, y: a.y, w: Math.max(0, b.x - a.x), h: Math.max(0, b.y - a.y) };
}

/** Inverse of anchorToRect: snap a viewport rect back to a two-cell anchor. */
export function rectToAnchor(
  g: ChartGeometrySource,
  zoom: number,
  frozenRows: number,
  frozenCols: number,
  rect: ViewportRect,
): ChartAnchor {
  const col = (px: number): ChartAnchorEdge => {
    const { index, offset } = viewportToContent(g, frozenRows, frozenCols, 'x', px);
    return { c: index, r: 0, offX: offset / zoom, offY: 0 };
  };
  const row = (px: number): ChartAnchorEdge => {
    const { index, offset } = viewportToContent(g, frozenRows, frozenCols, 'y', px);
    return { r: index, c: 0, offX: 0, offY: offset / zoom };
  };
  const fromCol = col(rect.x);
  const toCol = col(rect.x + rect.w);
  const fromRow = row(rect.y);
  const toRow = row(rect.y + rect.h);
  return {
    from: { r: fromRow.r, c: fromCol.c, offX: fromCol.offX, offY: fromRow.offY },
    to: { r: toRow.r, c: toCol.c, offX: toCol.offX, offY: toRow.offY },
  };
}

/** Excel "move and size with cells": rows/cols inserted at/after the edge push it down/right. */
export function shiftAnchorForInsert(anchor: ChartAnchor, axis: 'row' | 'col', start: number, count: number): ChartAnchor {
  const move = (e: ChartAnchorEdge): ChartAnchorEdge => {
    const v = axis === 'row' ? e.r : e.c;
    if (v < start) return e;
    return axis === 'row' ? { ...e, r: v + count } : { ...e, c: v + count };
  };
  return { from: move(anchor.from), to: move(anchor.to) };
}

/** Rows/cols deleted: edges past the band slide back; edges inside it clamp to the band start. */
export function shiftAnchorForDelete(anchor: ChartAnchor, axis: 'row' | 'col', start: number, count: number): ChartAnchor {
  const move = (e: ChartAnchorEdge): ChartAnchorEdge => {
    const v = axis === 'row' ? e.r : e.c;
    if (v >= start + count) return axis === 'row' ? { ...e, r: v - count } : { ...e, c: v - count };
    if (v >= start) return axis === 'row' ? { ...e, r: start } : { ...e, c: start };
    return e;
  };
  return { from: move(anchor.from), to: move(anchor.to) };
}

/** Normalize an anchor for rendering: ordered edges, clamped into the fixed grid. */
export function normalizeAnchor(anchor: ChartAnchor, totalRows: number, totalCols: number): ChartAnchor {
  const clampEdge = (e: ChartAnchorEdge, rMax: number, cMax: number): ChartAnchorEdge => ({
    r: Math.min(Math.max(0, Math.round(e.r)), rMax),
    c: Math.min(Math.max(0, Math.round(e.c)), cMax),
    offX: Math.max(0, e.offX),
    offY: Math.max(0, e.offY),
  });
  const from = clampEdge(anchor.from, totalRows - 1, totalCols - 1);
  const to = clampEdge(anchor.to, totalRows - 1, totalCols - 1);
  const flipR = to.r < from.r || (to.r === from.r && to.offY < from.offY);
  const flipC = to.c < from.c || (to.c === from.c && to.offX < from.offX);
  if (!flipR && !flipC) return { from, to };
  const a = { r: from.r, c: from.c, offX: from.offX, offY: from.offY };
  const b = { r: to.r, c: to.c, offX: to.offX, offY: to.offY };
  const [f, t] = flipR
    ? [{ ...a, r: b.r, offY: b.offY }, { ...b, r: a.r, offY: a.offY }]
    : [a, b];
  const [f2, t2] = flipC
    ? [{ ...f, c: t.c, offX: t.offX }, { ...t, c: f.c, offX: f.offX }]
    : [f, t];
  return { from: f2, to: t2 };
}

/** True when two anchors place the object at the same geometry (skip no-op undos). */
export function sameAnchor(a: ChartAnchor | undefined, b: ChartAnchor | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  return a.from.r === b.from.r && a.from.c === b.from.c && a.from.offX === b.from.offX && a.from.offY === b.from.offY
    && a.to.r === b.to.r && a.to.c === b.to.c && a.to.offX === b.to.offX && a.to.offY === b.to.offY;
}
