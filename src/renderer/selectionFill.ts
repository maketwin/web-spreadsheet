/** Selection fill bands with an active-cell (or merge) hole punched out. */

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * Return the rectangles to fill for a selection segment after punching out
 * `hole` (active cell / merged active area), clipped to the segment.
 * When `hole` is null, the whole segment is filled. When the hole covers the
 * entire segment, the result is empty (Excel: active area stays undimmed).
 */
export function selectionFillBands(seg: Rect, hole: Rect | null): Rect[] {
  if (hole === null) return [seg];
  const hx = Math.max(seg.x, hole.x);
  const hy = Math.max(seg.y, hole.y);
  const hx2 = Math.min(seg.x + seg.w, hole.x + hole.w);
  const hy2 = Math.min(seg.y + seg.h, hole.y + hole.h);
  const hw = hx2 - hx;
  const hh = hy2 - hy;
  if (hw <= 0 || hh <= 0) return [seg];
  const bands: Rect[] = [];
  if (hy > seg.y) bands.push({ x: seg.x, y: seg.y, w: seg.w, h: hy - seg.y });
  if (hy + hh < seg.y + seg.h) bands.push({ x: seg.x, y: hy + hh, w: seg.w, h: seg.y + seg.h - (hy + hh) });
  if (hx > seg.x) bands.push({ x: seg.x, y: hy, w: hx - seg.x, h: hh });
  if (hx + hw < seg.x + seg.w) bands.push({ x: hx + hw, y: hy, w: seg.x + seg.w - (hx + hw), h: hh });
  return bands;
}
