/**
 * Conditional-format cell decorations — the icon-set glyph (arrows3/lights3)
 * and the data-bar fill. Extracted from CanvasRenderer as pure ctx functions:
 * no store, no geometry, everything arrives as parameters.
 */

/** Excel icon-set glyph at the left edge of the cell: arrows3 = ▲►▼, lights3 = ●●●. */
export function paintIconSetIcon(ctx: CanvasRenderingContext2D, x: number, y: number, rh: number, icons: 'arrows3' | 'lights3', level: 0 | 1 | 2): void {
  const size = Math.min(10, rh - 6);
  if (size <= 2) return;
  const cx = x + 3 + size / 2;
  const cy = y + rh / 2;
  const half = size / 2;
  ctx.save();
  if (icons === 'lights3') {
    ctx.fillStyle = level === 0 ? '#63BE7B' : level === 1 ? '#FFDD71' : '#F8696B';
    ctx.beginPath();
    ctx.arc(cx, cy, half, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = level === 0 ? '#63BE7B' : level === 1 ? '#FFDD71' : '#F8696B';
    ctx.beginPath();
    if (level === 0) { // up triangle
      ctx.moveTo(cx, cy - half);
      ctx.lineTo(cx + half, cy + half);
      ctx.lineTo(cx - half, cy + half);
    } else if (level === 1) { // right triangle
      ctx.moveTo(cx - half, cy - half);
      ctx.lineTo(cx + half, cy);
      ctx.lineTo(cx - half, cy + half);
    } else { // down triangle
      ctx.moveTo(cx - half, cy - half);
      ctx.lineTo(cx + half, cy - half);
      ctx.lineTo(cx, cy + half);
    }
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/** Excel data bar: translucent fill proportional to the cell's ratio within its range. */
export function paintDataBar(ctx: CanvasRenderingContext2D, x: number, y: number, cw: number, rh: number, ratio: number, color: string): void {
  const barW = Math.max(0, (cw - 2) * ratio);
  ctx.save();
  ctx.globalAlpha = 0.4;
  ctx.fillStyle = color;
  ctx.fillRect(x + 1, y + 1, barW, rh - 2);
  ctx.globalAlpha = 1;
  ctx.restore();
}
