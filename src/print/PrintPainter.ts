/** Offscreen page renderer: paints one page band of the sheet onto a canvas.
 *
 * Mirrors CanvasRenderer's paint order (fills → gridlines → borders → text)
 * and its cell semantics (merge anchors, Excel text overflow, conditional
 * overlays), but is deliberately a separate, viewport-free implementation:
 * print needs page clipping, a fixed light palette, and no selection/freeze
 * chrome. The pure helpers (BorderPainter, wrapText, TextMetricsCache) are
 * shared with the screen renderer.
 */
import { ConditionalService } from '../conditional/ConditionalService';
import { formatValue } from '../format/NumberFormatter';
import { collectCellBorderEdges, edgesToPaintSegs, strokeBorderSegs, type LogicalBorderEdge } from '../renderer/BorderPainter';
import { COL_WIDTH, ROW_HEIGHT } from '../renderer/coordinate';
import { TextMetricsCache } from '../renderer/cache/TextMetricsCache';
import type { Store } from '../store/Store';
import type { Style, RichTextRun } from '../types';
import { parseRange } from '../util/cell';
import { isRich } from '../util/richText';
import { WRAP_LINE_HEIGHT, wrapTextLines } from '../util/wrapText';
import { drawRichLines, layoutRichText, richContentHeight } from '../renderer/richTextLayout';
import type { PageLayout } from './PrintPaginator';
import { PRINT_DPI_SCALE, contentPx, type PrintSettings } from './types';

/** Paper is always white; dark app themes must not darken the printout. */
const PRINT_BG = '#ffffff';
const PRINT_TEXT = '#000000';
const PRINT_GRID = '#bfbfbf';
const PRINT_FONT_STACK = 'Calibri, "Segoe UI", "Microsoft YaHei", sans-serif';

interface AxisGeometry {
  readonly offset: (i: number) => number;
  readonly size: (i: number) => number;
  readonly total: number;
}

export class PrintPainter {
  private readonly conditional = new ConditionalService();
  private readonly textMetrics = new TextMetricsCache();

  public constructor(private readonly store: Store, private readonly sheetId: string) {}

  /** Render one page: a content-area-sized canvas at PRINT_DPI_SCALE bitmap resolution. */
  public paint(page: PageLayout, scale: number, settings: PrintSettings): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    const content = contentPx(settings);
    canvas.width = Math.max(1, Math.round(content.w * PRINT_DPI_SCALE));
    canvas.height = Math.max(1, Math.round(content.h * PRINT_DPI_SCALE));
    const ctx = canvas.getContext('2d');
    if (ctx === null) {
      console.warn('[print] 2d context unavailable; page renders blank');
      return canvas;
    }
    // Grid-px coordinate system: the transform maps grid px → device px.
    ctx.setTransform(PRINT_DPI_SCALE * scale, 0, 0, PRINT_DPI_SCALE * scale, 0, 0);
    const pageW = content.w / scale;
    const pageH = content.h / scale;
    ctx.fillStyle = PRINT_BG;
    ctx.fillRect(-1, -1, pageW + 2, pageH + 2);

    const cols = this.axis(page.colStart, page.colEnd, (c) => this.colWidth(c));
    const rows = this.axis(page.rowStart, page.rowEnd, (r) => this.rowHeight(r));
    const skip = this.mergeSkip(page);
    this.paintBackgrounds(ctx, page, cols, rows);
    if (settings.showGrid) this.paintGridLines(ctx, page, cols, rows);
    this.paintBorders(ctx, page, cols, rows, pageW, pageH);
    this.paintTexts(ctx, page, cols, rows, skip);
    return canvas;
  }

  private axis(from: number, to: number, sizeAt: (i: number) => number): AxisGeometry {
    const offsets = new Float64Array(to - from + 1);
    let x = 0;
    for (let i = from; i <= to; i += 1) {
      offsets[i - from] = x;
      x += Math.max(0, sizeAt(i));
    }
    return {
      offset: (i: number): number => offsets[Math.max(0, Math.min(to, i) - from)] ?? 0,
      size: (i: number): number => (i < from || i > to ? 0 : Math.max(0, sizeAt(i))),
      total: x,
    };
  }

  private colWidth(c: number): number {
    const meta = this.store.getCol(c, this.sheetId);
    return meta !== undefined && meta.hide === true ? 0 : meta?.width ?? COL_WIDTH;
  }

  private rowHeight(r: number): number {
    const meta = this.store.getRow(r, this.sheetId);
    return meta !== undefined && meta.hide === true ? 0 : meta?.height ?? ROW_HEIGHT;
  }

  private cellStyle(r: number, c: number): Style | undefined {
    const cell = this.store.getCell(r, c, this.sheetId);
    return cell?.styleId === undefined ? undefined : this.store.getStyle(cell.styleId, this.sheetId);
  }

  /** Merge rect clipped to this page's band: merges cut by a page break still fill/border their visible part. */
  private mergeRectOnPage(range: { r1: number; c1: number; r2: number; c2: number }, page: PageLayout, cols: AxisGeometry, rows: AxisGeometry): { x: number; y: number; w: number; h: number } {
    const cA = Math.max(range.c1, page.colStart);
    const cB = Math.min(range.c2, page.colEnd);
    const rA = Math.max(range.r1, page.rowStart);
    const rB = Math.min(range.r2, page.rowEnd);
    const x = cols.offset(cA);
    const xEnd = cols.offset(cB) + cols.size(cB);
    const y = rows.offset(rA);
    const yEnd = rows.offset(rB) + rows.size(rB);
    return { x, y, w: xEnd - x, h: yEnd - y };
  }

  private pageMerges(page: PageLayout): Array<{ r1: number; c1: number; r2: number; c2: number }> {
    const out: Array<{ r1: number; c1: number; r2: number; c2: number }> = [];
    for (const merge of this.store.getMerges(this.sheetId)) {
      const range = parseRange(merge);
      if (range.r2 < page.rowStart || range.r1 > page.rowEnd || range.c2 < page.colStart || range.c1 > page.colEnd) continue;
      out.push(range);
    }
    return out;
  }

  /** Non-anchor cells covered by a merge on this page: no text of their own. */
  private mergeSkip(page: PageLayout): Set<string> {
    const skip = new Set<string>();
    for (const range of this.pageMerges(page)) {
      for (let r = Math.max(range.r1, page.rowStart); r <= Math.min(range.r2, page.rowEnd); r += 1) {
        for (let c = Math.max(range.c1, page.colStart); c <= Math.min(range.c2, page.colEnd); c += 1) {
          if (r !== range.r1 || c !== range.c1) skip.add(`${r},${c}`);
        }
      }
    }
    return skip;
  }

  private paintBackgrounds(ctx: CanvasRenderingContext2D, page: PageLayout, cols: AxisGeometry, rows: AxisGeometry): void {
    const merges = this.pageMerges(page);
    for (let r = page.rowStart; r <= page.rowEnd; r += 1) {
      if (this.rowHeight(r) <= 0) continue;
      for (let c = page.colStart; c <= page.colEnd; c += 1) {
        if (this.colWidth(c) <= 0) continue;
        const merge = merges.find((m) => r >= m.r1 && r <= m.r2 && c >= m.c1 && c <= m.c2);
        if (merge !== undefined) {
          // Idempotent full-rect fill at every covered cell (matches screen behavior).
          const rect = this.mergeRectOnPage(merge, page, cols, rows);
          this.paintFill(ctx, merge.r1, merge.c1, rect.x, rect.y, rect.w, rect.h);
          continue;
        }
        this.paintFill(ctx, r, c, cols.offset(c), rows.offset(r), cols.size(c), rows.size(r));
      }
    }
  }

  private paintFill(ctx: CanvasRenderingContext2D, r: number, c: number, x: number, y: number, w: number, h: number): void {
    const style = this.cellStyle(r, c);
    const overlay = this.conditional.computeOverlay(this.store, r, c, this.sheetId);
    const bgcolor = overlay.style?.bgcolor ?? style?.bgcolor;
    if (bgcolor !== undefined) {
      ctx.fillStyle = bgcolor;
      ctx.fillRect(x + 1, y + 1, Math.max(0, w - 2), Math.max(0, h - 2));
    }
    if (overlay.dataBar !== undefined) {
      const barW = Math.max(0, (w - 2) * overlay.dataBar.ratio);
      ctx.save();
      ctx.globalAlpha = 0.4;
      ctx.fillStyle = overlay.dataBar.color;
      ctx.fillRect(x + 1, y + 1, barW, Math.max(0, h - 2));
      ctx.globalAlpha = 1;
      ctx.restore();
    }
  }

  private paintGridLines(ctx: CanvasRenderingContext2D, page: PageLayout, cols: AxisGeometry, rows: AxisGeometry): void {
    const merges = this.pageMerges(page).map((m) => ({
      r1: Math.max(m.r1, page.rowStart), r2: Math.min(m.r2, page.rowEnd),
      c1: Math.max(m.c1, page.colStart), c2: Math.min(m.c2, page.colEnd),
    }));
    // Index → pixel boundary helpers (band-relative). Beyond the band edge means
    // the outer boundary: right/bottom edge of the last column/row. No half-pixel
    // offset: that screen-renderer trick pushes the outermost line off the bitmap
    // once the print scale widens strokes.
    const xAt = (idx: number): number => Math.round(idx > page.colEnd ? cols.offset(page.colEnd) + cols.size(page.colEnd) : cols.offset(idx));
    const yAt = (idx: number): number => Math.round(idx > page.rowEnd ? rows.offset(page.rowEnd) + rows.size(page.rowEnd) : rows.offset(idx));
    ctx.save();
    ctx.strokeStyle = PRINT_GRID;
    ctx.lineWidth = 1;
    ctx.beginPath();
    // Vertical boundaries, including the band's left/right outer edges (Excel
    // gridlines box the whole printed range). allowedIntervals yields row-index
    // spans — they must map through yAt() before hitting the path.
    for (let c = page.colStart; c <= page.colEnd + 1; c += 1) {
      const x = xAt(c);
      const forbidden = mergeRowIntervals(merges, 'v', c);
      for (const [a, b] of allowedIntervals(page.rowStart, page.rowEnd + 1, forbidden)) {
        ctx.moveTo(x, yAt(a));
        ctx.lineTo(x, yAt(b));
      }
    }
    // Horizontal boundaries, including the band's top/bottom outer edges.
    for (let r = page.rowStart; r <= page.rowEnd + 1; r += 1) {
      const y = yAt(r);
      const forbidden = mergeRowIntervals(merges, 'h', r);
      for (const [a, b] of allowedIntervals(page.colStart, page.colEnd + 1, forbidden)) {
        ctx.moveTo(xAt(a), y);
        ctx.lineTo(xAt(b), y);
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  private paintBorders(ctx: CanvasRenderingContext2D, page: PageLayout, cols: AxisGeometry, rows: AxisGeometry, pageW: number, pageH: number): void {
    const edges = new Map<string, LogicalBorderEdge>();
    const r0 = Math.max(0, page.rowStart - 1);
    const r1 = page.rowEnd + 1;
    const c0 = Math.max(0, page.colStart - 1);
    const c1 = page.colEnd + 1;
    for (let r = r0; r <= r1; r += 1) {
      for (let c = c0; c <= c1; c += 1) {
        collectCellBorderEdges(edges, r, c, this.cellStyle(r, c)?.border);
      }
    }
    // Excel: a merged cell's borders are its outer outline — interior edges vanish.
    for (const range of this.pageMerges(page)) {
      for (const [key, edge] of edges) {
        if (edge.orient === 'v' && edge.bound > range.c1 && edge.bound <= range.c2 && edge.along >= range.r1 && edge.along <= range.r2) edges.delete(key);
        else if (edge.orient === 'h' && edge.bound > range.r1 && edge.bound <= range.r2 && edge.along >= range.c1 && edge.along <= range.c2) edges.delete(key);
      }
    }
    const colLeft = (c: number): number => (c > page.colEnd ? cols.offset(page.colEnd) + cols.size(page.colEnd) : cols.offset(c));
    const rowTop = (r: number): number => (r > page.rowEnd ? rows.offset(page.rowEnd) + rows.size(page.rowEnd) : rows.offset(r));
    const segs = edgesToPaintSegs(edges.values(), {
      originX: 0,
      originY: 0,
      colLeft,
      rowTop,
      colWidth: (c: number): number => cols.size(Math.max(page.colStart, Math.min(page.colEnd, c))),
      rowHeight: (r: number): number => rows.size(Math.max(page.rowStart, Math.min(page.rowEnd, r))),
    });
    strokeBorderSegs(ctx, segs, 1, { x: 0, y: 0, w: pageW, h: pageH });
  }

  private paintTexts(ctx: CanvasRenderingContext2D, page: PageLayout, cols: AxisGeometry, rows: AxisGeometry, skip: Set<string>): void {
    const merges = this.pageMerges(page);
    for (let r = page.rowStart; r <= page.rowEnd; r += 1) {
      if (this.rowHeight(r) <= 0) continue;
      for (let c = page.colStart; c <= page.colEnd; c += 1) {
        if (this.colWidth(c) <= 0) continue;
        if (skip.has(`${r},${c}`)) continue;
        const merge = merges.find((m) => r >= m.r1 && r <= m.r2 && c >= m.c1 && c <= m.c2);
        if (merge !== undefined && (r !== merge.r1 || c !== merge.c1)) continue;
        const style = this.paintStyle(r, c);
        if (merge !== undefined) {
          const rect = this.mergeRectOnPage(merge, page, cols, rows);
          this.paintText(ctx, r, c, rect.x, rect.y, rect.w, rect.h, style, page, cols);
        } else {
          this.paintText(ctx, r, c, cols.offset(c), rows.offset(r), cols.size(c), rows.size(r), style, page, cols);
        }
      }
    }
  }

  private paintStyle(r: number, c: number): Style | undefined {
    const style = this.cellStyle(r, c);
    const overlay = this.conditional.computeOverlay(this.store, r, c, this.sheetId);
    return { ...style, ...overlay.style };
  }

  /** Print twin of CanvasRenderer.paintTextWith: alignment, wrap, overflow, underline, number formats. */
  private paintText(ctx: CanvasRenderingContext2D, r: number, c: number, x: number, y: number, cw: number, rh: number, style: Style | undefined, page: PageLayout, cols: AxisGeometry): void {
    const cell = this.store.getCell(r, c, this.sheetId);
    if (cell === undefined || cell.text.length === 0) return;
    const fontSize = Math.max(8, Math.round(style?.fontSize ?? 11));
    const fontFamily = style?.fontFamily ?? PRINT_FONT_STACK;
    const nf = style?.numberFormat;
    const formatted = nf !== undefined && nf !== 'general' ? formatValue(cell.value, nf) : undefined;
    const text = formatted?.formatted === true ? formatted.text : cell.text;
    const align = style?.align ?? 'left';
    const valign = style?.valign ?? 'middle';
    const wrapping = style?.wrap === true;

    // Rich runs (text constants only): shared layout, zoom scale 1.
    if (cell.formula === undefined && formatted?.formatted !== true && isRich(cell.richText)) {
      this.paintRichText(ctx, r, c, x, y, cw, rh, style, cell.richText, align, valign, wrapping, page, cols);
      return;
    }

    ctx.save();
    const clipY = y + 1;
    const clipH = Math.max(0, rh - 2);
    let clipX = x + 1;
    let clipW = Math.max(0, cw - 2);
    if (!wrapping) {
      const span = this.overflowSpan(r, c, x, cw, align, page, cols);
      clipX = span.left;
      clipW = Math.max(0, span.right - span.left);
    }
    ctx.beginPath();
    ctx.rect(clipX, clipY, clipW, clipH);
    ctx.clip();

    ctx.fillStyle = style?.color ?? PRINT_TEXT;
    ctx.textBaseline = 'middle';
    ctx.textAlign = align;
    const fontStr = `${style?.italic === true ? 'italic ' : ''}${style?.bold === true ? 'bold ' : ''}${fontSize}px ${fontFamily}`;
    ctx.font = fontStr;
    const tx = align === 'center' ? x + cw / 2 : align === 'right' ? x + cw - 3 : x + 3;
    const maxW = Math.max(4, cw - 6);
    const lines = wrapping ? wrapTextLines((t) => this.textMetrics.measure(ctx, fontStr, t), text, maxW) : [text.replace(/\r?\n/g, '')];
    const lineH = fontSize * WRAP_LINE_HEIGHT;
    const contentHeight = lines.length * lineH;
    const contentTop = valign === 'top'
      ? y + 2
      : valign === 'middle'
        ? y + rh / 2 - contentHeight / 2
        : y + rh - 2 - contentHeight;
    const startY = contentTop + lineH / 2;
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]!;
      const ly = startY + i * lineH;
      if (ly > y + rh) break;
      ctx.fillText(line, tx, ly);
      if (style?.underline === true) {
        const w = this.textMetrics.measure(ctx, fontStr, line);
        const sx = align === 'center' ? tx - w / 2 : align === 'right' ? tx - w : tx;
        ctx.beginPath();
        ctx.moveTo(sx, ly + fontSize * 0.38);
        ctx.lineTo(sx + w, ly + fontSize * 0.38);
        ctx.strokeStyle = String(ctx.fillStyle);
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /** Print twin of the grid's paintRichText: per-run fonts/colors through the shared layout. */
  private paintRichText(ctx: CanvasRenderingContext2D, r: number, c: number, x: number, y: number, cw: number, rh: number, style: Style | undefined, runs: readonly RichTextRun[], align: 'left' | 'center' | 'right', valign: 'top' | 'middle' | 'bottom', wrapping: boolean, page: PageLayout, cols: AxisGeometry): void {
    ctx.save();
    const clipY = y + 1;
    const clipH = Math.max(0, rh - 2);
    let clipX = x + 1;
    let clipW = Math.max(0, cw - 2);
    if (!wrapping) {
      const span = this.overflowSpan(r, c, x, cw, align, page, cols);
      clipX = span.left;
      clipW = Math.max(0, span.right - span.left);
    }
    ctx.beginPath();
    ctx.rect(clipX, clipY, clipW, clipH);
    ctx.clip();

    const lines = layoutRichText({
      runs,
      cellStyle: style,
      fontFamilyFallback: PRINT_FONT_STACK,
      colorFallback: PRINT_TEXT,
      measure: (font, text) => this.textMetrics.measure(ctx, font, text),
      maxWidth: Math.max(4, cw - 6),
      wrap: wrapping,
      fontSizeScale: 1,
      fontSizeFloor: 8,
    });
    const contentHeight = richContentHeight(lines);
    const contentTop = valign === 'top'
      ? y + 2
      : valign === 'middle'
        ? y + rh / 2 - contentHeight / 2
        : y + rh - 2 - contentHeight;
    drawRichLines(ctx, lines, x, cw, contentTop, align);
    ctx.restore();
  }

  /** Excel: without wrap, text spills into adjacent empty cells — within the page band only. */
  private overflowSpan(r: number, c: number, x: number, cw: number, align: 'left' | 'center' | 'right', page: PageLayout, cols: AxisGeometry): { left: number; right: number } {
    let left = x;
    let right = x + cw;
    if (align === 'left' || align === 'center') {
      for (let nc = c + 1; nc <= page.colEnd; nc += 1) {
        if (!this.allowsOverflow(r, nc)) break;
        right += cols.size(nc);
      }
    }
    if (align === 'right' || align === 'center') {
      for (let nc = c - 1; nc >= page.colStart; nc -= 1) {
        if (!this.allowsOverflow(r, nc)) break;
        left -= cols.size(nc);
      }
    }
    return { left: Math.max(0, left), right };
  }

  private allowsOverflow(r: number, c: number): boolean {
    if (this.store.getMergeAt(r, c, this.sheetId) !== undefined) return false;
    const cell = this.store.getCell(r, c, this.sheetId);
    if (cell !== undefined && cell.text.length > 0) return false;
    const style = this.cellStyle(r, c);
    if (style?.bgcolor !== undefined && style.bgcolor.toLowerCase() !== '#ffffff') return false;
    return true;
  }
}

/** Row intervals of merges that hide a vertical boundary at column `bound` (or column intervals for horizontal at row `bound`). */
function mergeRowIntervals(merges: ReadonlyArray<{ r1: number; c1: number; r2: number; c2: number }>, orient: 'v' | 'h', bound: number): Array<[number, number]> {
  const intervals: Array<[number, number]> = [];
  for (const m of merges) {
    const inside = orient === 'v' ? bound > m.c1 && bound <= m.c2 : bound > m.r1 && bound <= m.r2;
    if (!inside) continue;
    const from = orient === 'v' ? m.r1 : m.c1;
    const to = orient === 'v' ? m.r2 : m.c2;
    intervals.push([from, to]);
  }
  return intervals;
}

/** [from, to] minus forbidden closed intervals, as half-open pixel spans. */
function allowedIntervals(from: number, to: number, forbidden: ReadonlyArray<readonly [number, number]>): Array<[number, number]> {
  if (forbidden.length === 0) return [[from, to]];
  const sorted = [...forbidden].sort((a, b) => a[0] - b[0]);
  const spans: Array<[number, number]> = [];
  let cursor = from;
  for (const [f, t] of sorted) {
    if (f > cursor) spans.push([cursor, Math.min(f, to)]);
    cursor = Math.max(cursor, t + 1);
    if (cursor >= to) break;
  }
  if (cursor < to) spans.push([cursor, to]);
  return spans.filter(([a, b]) => b > a);
}
