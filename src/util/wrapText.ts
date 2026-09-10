/** Split text into wrapped lines (Excel-like soft wrap + hard breaks). */
export function wrapTextLines(measureWidth: (text: string) => number, text: string, maxWidth: number): string[] {
  const paragraphs = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    if (paragraph.length === 0) {
      lines.push('');
      continue;
    }
    let current = '';
    for (const ch of paragraph) {
      const next = current + ch;
      const width = measureWidth(next);
      if (current.length > 0 && width > maxWidth) {
        lines.push(current);
        current = ch;
      } else {
        current = next;
      }
    }
    lines.push(current);
  }
  return lines.length > 0 ? lines : [''];
}

export function wrapTextLinesCanvas(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  return wrapTextLines((s) => (typeof ctx.measureText === 'function' ? ctx.measureText(s).width : s.length * 8), text, maxWidth);
}

/** Line height factor used when painting wrapped text on canvas. */
export const WRAP_LINE_HEIGHT = 1.25;

/**
 * Excel default: Calibri 11 → row height 15pt ≈ 20px at 96dpi.
 * Scale other sizes from that 11→20 baseline.
 */
export function excelRowHeightPx(fontSize: number, lineCount = 1): number {
  const size = Math.max(1, fontSize);
  const lines = Math.max(1, lineCount);
  const single = Math.round(size * (20 / 11));
  if (lines === 1) return single;
  return Math.round(single + (lines - 1) * size * (20 / 11));
}

/** @deprecated prefer excelRowHeightPx — kept for call sites that used the old helper name */
export function wrappedContentHeight(lineCount: number, fontSize: number): number {
  return excelRowHeightPx(fontSize, lineCount);
}
