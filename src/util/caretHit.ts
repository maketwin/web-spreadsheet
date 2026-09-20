import { DEFAULT_FONT_SIZE } from './defaults';
import { resolveCellAlign } from './generalAlign';
import { WRAP_LINE_HEIGHT, wrapTextLines } from './wrapText';
import type { Style } from '../types';

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
}

/**
 * Map a click inside a cell rect to a flat text offset (Excel double-click caret).
 * Handles Alt+Enter hard breaks and wrap-text soft lines via measureText.
 */
export function caretOffsetFromLocalPoint(input: CaretHitInput): number {
  const text = input.text;
  if (text.length === 0) return 0;
  const zoom = input.zoom ?? 100;
  const scale = zoom / 100;
  const style = input.style;
  const fontSize = Math.max(8, Math.round((style?.fontSize ?? DEFAULT_FONT_SIZE) * scale));
  const fontFamily = style?.fontFamily ?? 'Calibri, "Segoe UI", "Microsoft YaHei", sans-serif';
  const font = `${style?.italic === true ? 'italic ' : ''}${style?.bold === true ? 'bold ' : ''}${fontSize}px ${fontFamily}`;
  let measure: CanvasRenderingContext2D | null = null;
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  // jsdom implements getContext but only to log "Not implemented" — use heuristic widths there.
  if (typeof document !== 'undefined' && !/jsdom/i.test(ua)) {
    try {
      measure = document.createElement('canvas').getContext('2d');
    } catch {
      measure = null;
    }
  }
  const widthOf = (s: string): number => {
    if (measure === null) return s.length * fontSize * 0.55;
    measure.font = font;
    return measure.measureText(s).width;
  };

  const wrapping = style?.wrap === true;
  const { lines, starts } = wrapping
    ? wrapLinesWithStarts(widthOf, text, Math.max(4, input.cellW - 6))
    : hardLinesWithStarts(text);
  const lineH = fontSize * WRAP_LINE_HEIGHT;
  const contentHeight = lines.length * lineH;
  const valign = style?.valign ?? 'middle';
  const contentTop = valign === 'top'
    ? 2
    : valign === 'middle'
      ? input.cellH / 2 - contentHeight / 2
      : input.cellH - 2 - contentHeight;

  let lineIndex = Math.floor((input.localY - contentTop) / lineH);
  if (lineIndex < 0) lineIndex = 0;
  if (lineIndex >= lines.length) lineIndex = lines.length - 1;
  const line = lines[lineIndex] ?? '';
  const offset = starts[lineIndex] ?? 0;

  const align = resolveCellAlign(style?.align, input.value, { showFormula: false, formula: input.formula });
  const pad = 3;
  const fullW = widthOf(line);
  let origin = pad;
  if (align === 'right') origin = input.cellW - pad - fullW;
  else if (align === 'center') origin = (input.cellW - fullW) / 2;
  const x = input.localX - origin;

  if (x <= 0) return offset;
  let acc = 0;
  for (let i = 0; i < line.length; i += 1) {
    const cw = widthOf(line[i]!);
    if (acc + cw / 2 >= x) return offset + i;
    acc += cw;
  }
  return offset + line.length;
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

/** Same visual lines as wrapTextLines, plus flat source start index per line. */
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
