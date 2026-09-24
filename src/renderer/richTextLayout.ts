import type { RichTextRun, Style } from '../types';
import { effectiveRunStyle } from '../util/richText';
import { WRAP_LINE_HEIGHT } from '../util/wrapText';

/**
 * Shared rich-text layout used by both paint paths (grid CanvasRenderer and
 * print PrintPainter). Produces positioned line/segment geometry at font
 * sizes already multiplied by the caller's scale (canvas zoom; print = 1),
 * so drawing needs no further transforms. Widths are measured per character
 * with the character's own font — mixed-size lines can't be measured as one
 * string, and per-char widths keep segment widths consistent with the wrap
 * decisions (kerning-level differences are accepted, like the plain path).
 */

const SCRIPT_FACTOR = 0.62;
/** Alphabetic-baseline offset from the line's vertical middle, in em. */
const BASELINE_EM = 0.33;
const SUPER_RAISE_EM = 0.32;
const SUB_LOWER_EM = 0.14;
/** Cell text padding, duplicated from the plain paint paths. */
const PAD_X = 3;

export interface RichSegment {
  text: string;
  /** Canvas font string at the drawn (scaled) size. */
  font: string;
  color: string;
  /** Size actually drawn (script runs are scaled down). */
  drawSize: number;
  underline: boolean;
  strike: boolean;
  vertAlign?: 'subscript' | 'superscript';
  /** Vertical offset from the line baseline. */
  baselineShift: number;
  /** Sum of per-char measured widths. */
  width: number;
}

export interface RichLine {
  segments: RichSegment[];
  width: number;
  /** Largest font size in the line (pre-script-scale) — drives the line height. */
  maxFontSize: number;
  lineHeight: number;
}

export interface LayoutRichTextOptions {
  runs: readonly RichTextRun[];
  cellStyle: Style | undefined;
  /** Theme default when neither cell nor run names a font. */
  fontFamilyFallback: string;
  /** Theme default when neither cell nor run names a color. */
  colorFallback: string;
  measure: (font: string, text: string) => number;
  maxWidth: number;
  wrap: boolean;
  /** Canvas zoom; print passes 1. */
  fontSizeScale?: number;
  /** The paint paths floor zoomed sizes at 8px; measurement-only callers pass 1. */
  fontSizeFloor?: number;
}

interface CharItem {
  piece: ResolvedPiece;
  ch: string;
  width: number;
}

interface ResolvedPiece {
  text: string;
  font: string;
  color: string;
  drawSize: number;
  size: number;
  underline: boolean;
  strike: boolean;
  vertAlign?: 'subscript' | 'superscript';
  baselineShift: number;
}

/** Lay runs out into lines. Hard `\n` breaks always split; soft wrap only when `wrap`. */
export function layoutRichText(opts: LayoutRichTextOptions): RichLine[] {
  const scale = opts.fontSizeScale ?? 1;
  const floor = opts.fontSizeFloor ?? 1;
  const pieces: ResolvedPiece[] = [];
  for (const run of opts.runs) {
    if (run.text === '') continue;
    const eff = effectiveRunStyle(opts.cellStyle, run);
    const size = Math.max(floor, Math.round(eff.fontSize * scale));
    const drawSize = Math.max(1, Math.round(size * (eff.vertAlign !== undefined ? SCRIPT_FACTOR : 1)));
    const family = eff.fontFamily ?? opts.fontFamilyFallback;
    pieces.push({
      text: run.text,
      font: `${eff.italic ? 'italic ' : ''}${eff.bold ? 'bold ' : ''}${drawSize}px ${family}`,
      color: eff.color ?? opts.colorFallback,
      drawSize,
      size,
      underline: eff.underline,
      strike: eff.strike,
      ...(eff.vertAlign !== undefined ? { vertAlign: eff.vertAlign } : {}),
      baselineShift: eff.vertAlign === 'superscript' ? -SUPER_RAISE_EM * drawSize : eff.vertAlign === 'subscript' ? SUB_LOWER_EM * drawSize : 0,
    });
  }
  if (pieces.length === 0) return [];

  const chars: CharItem[] = [];
  for (const piece of pieces) {
    for (const ch of piece.text) {
      if (ch === '\n') {
        chars.push({ piece, ch, width: 0 });
        continue;
      }
      chars.push({ piece, ch, width: opts.measure(piece.font, ch) });
    }
  }

  const lines: RichLine[] = [];
  const wrapOn = opts.wrap && opts.maxWidth > 0;
  let current: CharItem[] = [];
  let currentWidth = 0;

  const fallbackSize = pieces[0]?.size ?? Math.max(floor, Math.round((opts.cellStyle?.fontSize ?? 11) * scale));
  const emptyLine = (): RichLine => ({ segments: [], width: 0, maxFontSize: fallbackSize, lineHeight: Math.max(1, fallbackSize) * WRAP_LINE_HEIGHT });
  let hardBreak = false;

  const pushLine = (): void => {
    if (current.length === 0) return;
    lines.push(coalesceLine(current));
    current = [];
    currentWidth = 0;
  };

  for (const item of chars) {
    if (item.ch === '\n') {
      // A break on an empty line still occupies a row (`a\n\nb`).
      lines.push(current.length === 0 ? emptyLine() : coalesceLine(current));
      current = [];
      currentWidth = 0;
      hardBreak = true;
      continue;
    }
    hardBreak = false;
    if (wrapOn && currentWidth > 0 && currentWidth + item.width > opts.maxWidth) pushLine();
    currentWidth += item.width;
    current.push(item);
  }
  if (current.length > 0) pushLine();
  else if (hardBreak) lines.push(emptyLine());
  return lines;
}

function coalesceLine(items: readonly CharItem[]): RichLine {
  const segments: RichSegment[] = [];
  let width = 0;
  let maxFontSize = 0;
  for (const item of items) {
    width += item.width;
    if (item.piece.size > maxFontSize) maxFontSize = item.piece.size;
    const last = segments[segments.length - 1];
    if (last !== undefined && sameSegmentStyle(last, item.piece)) {
      last.text += item.ch;
      last.width += item.width;
    } else {
      segments.push({ text: item.ch, font: item.piece.font, color: item.piece.color, drawSize: item.piece.drawSize, underline: item.piece.underline, strike: item.piece.strike, ...(item.piece.vertAlign !== undefined ? { vertAlign: item.piece.vertAlign } : {}), baselineShift: item.piece.baselineShift, width: item.width });
    }
  }
  return { segments, width, maxFontSize, lineHeight: Math.max(1, maxFontSize) * WRAP_LINE_HEIGHT };
}

function sameSegmentStyle(seg: RichSegment, piece: ResolvedPiece): boolean {
  return seg.font === piece.font && seg.color === piece.color && seg.underline === piece.underline && seg.strike === piece.strike && seg.vertAlign === piece.vertAlign;
}

/** Total height of a laid-out block (for valign positioning). */
export function richContentHeight(lines: readonly RichLine[]): number {
  return lines.reduce((sum, line) => sum + line.lineHeight, 0);
}

/**
 * Draw laid-out lines inside the cell rect anchored at `x`/`cw` with the
 * plain paths' alignment conventions (left inset 3px, center/right on the
 * rect; `indentPx` shifts left/right-anchored lines in by the cell indent).
 * Underline/strike are stroked per segment so mixed styles stay put.
 */
export function drawRichLines(ctx: CanvasRenderingContext2D, lines: readonly RichLine[], x: number, cw: number, contentTop: number, align: 'left' | 'center' | 'right', indentPx = 0): void {
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  let lineTop = contentTop;
  for (const line of lines) {
    const baselineY = lineTop + line.lineHeight / 2 + BASELINE_EM * line.maxFontSize;
    let sx = align === 'center' ? x + cw / 2 - line.width / 2 : align === 'right' ? x + cw - PAD_X - indentPx - line.width : x + PAD_X + indentPx;
    for (const seg of line.segments) {
      const by = baselineY + seg.baselineShift;
      ctx.font = seg.font;
      ctx.fillStyle = seg.color;
      ctx.fillText(seg.text, sx, by);
      if (seg.underline || seg.strike) {
        ctx.strokeStyle = seg.color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        if (seg.underline) {
          const uy = by + Math.max(1.5, seg.drawSize * 0.1);
          ctx.moveTo(sx, uy);
          ctx.lineTo(sx + seg.width, uy);
        }
        if (seg.strike) {
          const sy = by - seg.drawSize * 0.3;
          ctx.moveTo(sx, sy);
          ctx.lineTo(sx + seg.width, sy);
        }
        ctx.stroke();
      }
      sx += seg.width;
    }
    lineTop += line.lineHeight;
  }
}
