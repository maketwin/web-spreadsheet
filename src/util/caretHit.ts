import { DEFAULT_FONT_SIZE } from './defaults';
import { resolveCellAlign } from './generalAlign';
import { WRAP_LINE_HEIGHT, wrapTextLines } from './wrapText';
import type { RichTextRun, Style } from '../types';
import { isRich } from './richText';

export interface CaretHitInput {
  readonly text: string;
  readonly localX: number;
  readonly localY: number;
  readonly cellW: number;
  readonly cellH: number;
  readonly style?: Style | undefined;
  readonly value?: unknown;
  readonly formula?: string | undefined;
  readonly zoom?: number;
  /** Per-run fonts for mixed-size double-click caret (Excel). */
  readonly runs?: readonly RichTextRun[] | undefined;
}

/**
 * Map a click inside a cell rect to a flat text offset (Excel double-click caret).
 * Handles Alt+Enter hard breaks, wrap-text soft lines, and per-run font sizes.
 */
export function caretOffsetFromLocalPoint(input: CaretHitInput): number {
  const text = input.text;
  if (text.length === 0) return 0;
  const zoom = input.zoom ?? 100;
  const scale = zoom / 100;
  const style = input.style;
  const baseSize = Math.max(8, Math.round((style?.fontSize ?? DEFAULT_FONT_SIZE) * scale));
  const fontFamily = style?.fontFamily ?? 'Calibri, "Segoe UI", "Microsoft YaHei", sans-serif';
  let measure: CanvasRenderingContext2D | null = null;
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (typeof document !== 'undefined' && !/jsdom/i.test(ua)) {
    try { measure = document.createElement('canvas').getContext('2d'); } catch { measure = null; }
  }

  const fontAt = (flatIndex: number): { size: number; font: string } => {
    const runStyle = styleAt(input.runs, flatIndex);
    const size = Math.max(8, Math.round((runStyle?.fontSize ?? style?.fontSize ?? DEFAULT_FONT_SIZE) * scale));
    const bold = runStyle?.bold ?? style?.bold === true;
    const italic = runStyle?.italic ?? style?.italic === true;
    const family = runStyle?.fontFamily ?? fontFamily;
    return { size, font: `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${size}px ${family}` };
  };

  const widthOfRange = (from: number, to: number): number => {
    let w = 0;
    for (let i = from; i < to; i += 1) {
      const { size, font } = fontAt(i);
      if (measure === null) { w += size * 0.55; continue; }
      measure.font = font;
      w += measure.measureText(text[i]!).width;
    }
    return w;
  };

  const widthOf = (s: string, startFlat = 0): number => {
    if (!isRich(input.runs)) {
      const font = `${style?.italic === true ? 'italic ' : ''}${style?.bold === true ? 'bold ' : ''}${baseSize}px ${fontFamily}`;
      if (measure === null) return s.length * baseSize * 0.55;
      measure.font = font;
      return measure.measureText(s).width;
    }
    return widthOfRange(startFlat, startFlat + s.length);
  };

  const wrapping = style?.wrap === true;
  const { lines, starts } = wrapping
    ? (isRich(input.runs)
      ? wrapLinesWithStartsRich(widthOfRange, text, Math.max(4, input.cellW - 6))
      : wrapLinesWithStarts((s) => widthOf(s, 0), text, Math.max(4, input.cellW - 6)))
    : hardLinesWithStarts(text);

  // Line height: use max run size on each visual line when rich.
  const lineHeights = lines.map((line, li) => {
    const start = starts[li] ?? 0;
    let max = baseSize;
    for (let i = 0; i < line.length; i += 1) max = Math.max(max, fontAt(start + i).size);
    return max * WRAP_LINE_HEIGHT;
  });
  const contentHeight = lineHeights.reduce((a, b) => a + b, 0);
  const valign = style?.valign ?? 'middle';
  const contentTop = valign === 'top'
    ? 2
    : valign === 'middle'
      ? input.cellH / 2 - contentHeight / 2
      : input.cellH - 2 - contentHeight;

  let yCursor = contentTop;
  let lineIndex = lines.length - 1;
  for (let i = 0; i < lines.length; i += 1) {
    const h = lineHeights[i] ?? baseSize * WRAP_LINE_HEIGHT;
    if (input.localY < yCursor + h) { lineIndex = i; break; }
    yCursor += h;
  }
  const line = lines[lineIndex] ?? '';
  const offset = starts[lineIndex] ?? 0;

  const align = resolveCellAlign(style?.align, input.value, { showFormula: false, formula: input.formula });
  const pad = 3;
  const fullW = widthOf(line, offset);
  let origin = pad;
  if (align === 'right') origin = input.cellW - pad - fullW;
  else if (align === 'center') origin = (input.cellW - fullW) / 2;
  const x = input.localX - origin;

  if (x <= 0) return offset;
  let acc = 0;
  for (let i = 0; i < line.length; i += 1) {
    const cw = widthOf(line[i]!, offset + i);
    if (acc + cw / 2 >= x) return offset + i;
    acc += cw;
  }
  return offset + line.length;
}

function styleAt(runs: readonly RichTextRun[] | undefined, flatIndex: number): RichTextRun['style'] {
  if (!isRich(runs)) return undefined;
  let pos = 0;
  for (const run of runs) {
    const next = pos + run.text.length;
    if (flatIndex < next) return run.style;
    pos = next;
  }
  return runs[runs.length - 1]?.style;
}

function hardLinesWithStarts(text: string): { lines: string[]; starts: number[] } {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  const starts: number[] = [];
  let pos = 0;
  for (let i = 0; i < lines.length; i += 1) {
    starts.push(pos);
    pos += (lines[i]?.length ?? 0) + (i < lines.length - 1 ? 1 : 0);
  }
  return { lines, starts };
}


/** Soft-wrap with absolute flat offsets so mixed run font sizes measure correctly. */
function wrapLinesWithStartsRich(
  widthOfRange: (from: number, to: number) => number,
  text: string,
  maxWidth: number,
): { lines: string[]; starts: number[] } {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const paragraphs = normalized.split('\n');
  const lines: string[] = [];
  const starts: number[] = [];
  let abs = 0;
  for (let pi = 0; pi < paragraphs.length; pi += 1) {
    const paragraph = paragraphs[pi] ?? '';
    const paraStart = abs;
    if (paragraph.length === 0) {
      lines.push('');
      starts.push(paraStart);
      abs += pi < paragraphs.length - 1 ? 1 : 0;
      continue;
    }
    let lineStart = paraStart;
    let lineLen = 0;
    for (let i = 0; i < paragraph.length; i += 1) {
      const nextLen = lineLen + 1;
      const width = widthOfRange(lineStart, lineStart + nextLen);
      if (lineLen > 0 && width > maxWidth) {
        lines.push(paragraph.slice(lineStart - paraStart, lineStart - paraStart + lineLen));
        starts.push(lineStart);
        lineStart = paraStart + i;
        lineLen = 1;
      } else {
        lineLen = nextLen;
      }
    }
    lines.push(paragraph.slice(lineStart - paraStart, lineStart - paraStart + lineLen));
    starts.push(lineStart);
    abs = paraStart + paragraph.length + (pi < paragraphs.length - 1 ? 1 : 0);
  }
  return { lines: lines.length > 0 ? lines : [''], starts: starts.length > 0 ? starts : [0] };
}

function wrapLinesWithStarts(
  measureWidth: (text: string) => number,
  text: string,
  maxWidth: number,
): { lines: string[]; starts: number[] } {
  const lines = wrapTextLines(measureWidth, text, maxWidth);
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const starts: number[] = [];
  let pos = 0;
  for (const line of lines) {
    if (line === '') {
      starts.push(pos);
      if (pos < normalized.length && normalized[pos] === '\n') pos += 1;
      continue;
    }
    while (pos < normalized.length && normalized[pos] === '\n') pos += 1;
    starts.push(pos);
    pos += line.length;
  }
  return { lines, starts };
}
