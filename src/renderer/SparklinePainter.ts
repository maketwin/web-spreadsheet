import type { Store } from '../store/Store';
import type { VirtualScroller } from './VirtualScroller';
import type { Rect } from './DirtyRegionTracker';
import { sparklineValues } from '../sparkline/values';
import type { SparklineSpec } from '../sparkline/types';

/**
 * Excel sparklines: mini line/bar/win-loss charts drawn inside their anchor
 * cell. Extracted from CanvasRenderer; geometry access is injected.
 */

/** Sparkline series colors, matching the React Sparkline component. */
export const SPARKLINE_COLOR = '#4A90D9';
export const SPARKLINE_LOSS_COLOR = '#D94A4A';

/** Structural slice of CanvasRenderer's PaintQuad — clip rect plus the cell
 * window the quadrant covers. Kept local so this module has no import edge
 * back into CanvasRenderer. */
export interface SparkQuad {
  r0: number;
  r1: number;
  c0: number;
  c1: number;
  clip: Rect;
}

export interface SparklineDeps {
  readonly ctx: CanvasRenderingContext2D;
  readonly store: Store;
  readonly scroller: VirtualScroller;
  cellVP(r: number, c: number): { x: number; y: number };
}

export function paintSparklines(deps: SparklineDeps, quads: readonly SparkQuad[]): void {
  const sparklines = deps.store.getSparklines();
  if (sparklines.length === 0) return;
  for (const spec of sparklines) {
    if (deps.store.getRow(spec.row)?.hide === true) continue;
    if (deps.store.getCol(spec.col)?.hide === true) continue;
    for (const q of quads) {
      if (spec.row < q.r0 || spec.row >= q.r1 || spec.col < q.c0 || spec.col >= q.c1) continue;
      withClip(deps.ctx, q.clip, () => paintSparkline(deps, spec));
    }
  }
}

/** Run `paint` clipped to a viewport rect (quadrant separation). */
function withClip(ctx: CanvasRenderingContext2D, clip: Rect, paint: () => void): void {
  if (clip.w <= 0 || clip.h <= 0) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(clip.x, clip.y, clip.w, clip.h);
  ctx.clip();
  paint();
  ctx.restore();
}

function paintSparkline(deps: SparklineDeps, spec: SparklineSpec): void {
  const { ctx, store, scroller } = deps;
  const data = sparklineValues(store, spec.range);
  if (data.length === 0) return;
  const { x, y } = deps.cellVP(spec.row, spec.col);
  const w = scroller.getColWidth(spec.col);
  const h = scroller.getRowHeight(spec.row);
  const pad = 3;
  const iw = Math.max(w - pad * 2, 0);
  const ih = Math.max(h - pad * 2, 0);
  if (iw < 2 || ih < 2) return;
  const cx = x + pad;
  const cy = y + pad;
  if (spec.type === 'line') {
    const min = Math.min(...data);
    const max = Math.max(...data);
    const span = max - min || 1;
    const step = iw / Math.max(data.length - 1, 1);
    ctx.strokeStyle = SPARKLINE_COLOR;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    data.forEach((v, i) => {
      const px = cx + i * step;
      const py = cy + ih - ((v - min) / span) * ih;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.stroke();
    return;
  }
  const gap = 1;
  const barW = Math.max(iw / data.length - gap, 1);
  if (spec.type === 'winloss') {
    // Excel 盈亏图: magnitudes are ignored — every win is an equal block above
    // the midline, every loss an equal (red) block below it; zeros are gaps.
    const half = ih / 2;
    data.forEach((v, i) => {
      if (v === 0) return;
      const bx = cx + i * (barW + gap);
      ctx.fillStyle = v > 0 ? SPARKLINE_COLOR : SPARKLINE_LOSS_COLOR;
      ctx.fillRect(bx, v > 0 ? cy : cy + half, barW, half);
    });
    return;
  }
  // Bar (Excel 柱形迷你图): bars start at the zero line — positives grow up,
  // negatives hang below it.
  const min = Math.min(0, ...data);
  const max = Math.max(...data, 0);
  const span = max - min || 1;
  const zeroY = cy + ((max - 0) / span) * ih;
  data.forEach((v, i) => {
    const bx = cx + i * (barW + gap);
    const bh = Math.max((Math.abs(v) / span) * ih, v === 0 ? 0 : 1);
    ctx.fillStyle = SPARKLINE_COLOR;
    ctx.fillRect(bx, v >= 0 ? zeroY - bh : zeroY, barW, bh);
  });
}
