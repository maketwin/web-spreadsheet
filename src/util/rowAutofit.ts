import { COL_WIDTH, ROW_HEIGHT, TOTAL_COLS } from '../renderer/coordinate';
import { Command } from '../commands/Command';
import type { Store } from '../store/Store';
import type { RangeAddress } from '../selection/Range';
import type { RowMeta } from '../types';
import { effectiveRunStyle, flattenRuns, isRich } from './richText';
import { layoutRichText } from '../renderer/richTextLayout';
import { excelRowHeightPx, wrapTextLinesCanvas } from './wrapText';

function clampVal(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function lineCountForCell(
  store: Store,
  r: number,
  c: number,
  ctx: CanvasRenderingContext2D | null,
): { fontSize: number; lineCount: number; hasText: boolean } {
  const cell = store.getCell(r, c);
  const style = cell?.styleId === undefined ? undefined : store.getStyle(cell.styleId);
  const text = cell?.text ?? '';
  if (text.length === 0) return { fontSize: style?.fontSize ?? 11, lineCount: 1, hasText: false };

  const fontFamily = style?.fontFamily ?? 'Calibri, "Segoe UI", "Microsoft YaHei", sans-serif';

  // Rich runs: line height follows the largest run font; wrap counts through the shared layout.
  if (cell !== undefined && isRich(cell.richText)) {
    const runs = cell.richText;
    const maxFontSize = runs.reduce((max, run) => Math.max(max, effectiveRunStyle(style, run).fontSize), 1);
    const colW = store.getCol(c)?.width ?? COL_WIDTH;
    let lineCount = 1;
    if (style?.wrap === true && ctx !== null) {
      const lines = layoutRichText({
        runs,
        cellStyle: style,
        fontFamilyFallback: fontFamily,
        colorFallback: '#000000',
        measure: (font, sample) => {
          ctx.font = font;
          return ctx.measureText(sample).width;
        },
        maxWidth: Math.max(4, colW - 6),
        wrap: true,
        fontSizeScale: 1,
        fontSizeFloor: 1,
      });
      lineCount = Math.max(1, lines.length);
    } else if (style?.wrap === true) {
      const flat = flattenRuns(runs);
      const charsPerLine = Math.max(1, Math.floor((colW - 6) / (maxFontSize * 0.55)));
      const hard = flat.replace(/\r\n/g, '\n').split('\n');
      lineCount = hard.reduce((sum, part) => sum + Math.max(1, Math.ceil(Math.max(1, part.length) / charsPerLine)), 0);
    }
    return { fontSize: maxFontSize, lineCount, hasText: true };
  }

  const fontSize = style?.fontSize ?? 11;
  const font = `${style?.italic === true ? 'italic ' : ''}${style?.bold === true ? 'bold ' : ''}${fontSize}px ${fontFamily}`;
  const colW = store.getCol(c)?.width ?? COL_WIDTH;
  let lineCount = 1;
  if (style?.wrap === true && ctx !== null) {
    ctx.font = font;
    lineCount = wrapTextLinesCanvas(ctx, text, Math.max(4, colW - 6)).length;
  } else if (style?.wrap === true) {
    const charsPerLine = Math.max(1, Math.floor((colW - 6) / (fontSize * 0.55)));
    const hard = text.replace(/\r\n/g, '\n').split('\n');
    lineCount = hard.reduce((sum, part) => sum + Math.max(1, Math.ceil(Math.max(1, part.length) / charsPerLine)), 0);
  }
  return { fontSize, lineCount, hasText: true };
}

/** Autofit one row from cell contents (row-header double-click). */
export function autoFitRowHeight(store: Store, r: number): number {
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  const ctx = canvas?.getContext('2d') ?? null;
  let maxH = ROW_HEIGHT;
  let hasContent = false;
  for (let c = 0; c < TOTAL_COLS; c += 1) {
    const { fontSize, lineCount, hasText } = lineCountForCell(store, r, c, ctx);
    if (!hasText) continue;
    hasContent = true;
    maxH = Math.max(maxH, excelRowHeightPx(fontSize, lineCount));
  }
  if (!hasContent) return ROW_HEIGHT;
  return clampVal(maxH, 15, 500);
}

/**
 * Excel: after changing font size / wrap on a selection, row height follows the
 * largest required height for cells in that selection (empty cells still count
 * via the applied font size). Pure measurement — the style command that
 * triggers the autofit folds these into its single undo unit.
 */
export function autofitRowHeights(store: Store, range: RangeAddress): readonly { readonly r: number; readonly height: number }[] {
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  const ctx = canvas?.getContext('2d') ?? null;
  const out: Array<{ readonly r: number; readonly height: number }> = [];
  for (let r = range.r1; r <= range.r2; r += 1) {
    let maxH = ROW_HEIGHT;
    for (let c = range.c1; c <= range.c2; c += 1) {
      const { fontSize, lineCount, hasText } = lineCountForCell(store, r, c, ctx);
      // Excel grows the row for the selection's font even before text is typed
      maxH = Math.max(maxH, excelRowHeightPx(fontSize, hasText ? lineCount : 1));
    }
    // Also respect taller content elsewhere on the same row outside the selection
    for (let c = 0; c < TOTAL_COLS; c += 1) {
      if (c >= range.c1 && c <= range.c2) continue;
      const { fontSize, lineCount, hasText } = lineCountForCell(store, r, c, ctx);
      if (!hasText) continue;
      maxH = Math.max(maxH, excelRowHeightPx(fontSize, lineCount));
    }
    out.push({ r, height: clampVal(maxH, 15, 500) });
  }
  return out;
}

/**
 * Excel: a font size / wrap change is one undo step that includes the
 * row-height adjustment it triggers. Measured lazily at execute time so it
 * sees the style the companion SetRangeStyleCommand just applied.
 */
export class AutoRowHeightsCommand extends Command<RangeAddress> {
  private before: readonly (readonly [number, RowMeta | undefined])[] = [];

  public execute(sheet: Store): void {
    const before: Array<readonly [number, RowMeta | undefined]> = [];
    for (const { r, height } of autofitRowHeights(sheet, this.args)) {
      const meta = sheet.getRow(r);
      before.push([r, meta]);
      sheet.setRow(r, { ...meta, height });
    }
    this.before = before;
  }

  public getUndo(): Command {
    return new RestoreRowHeights(this.before);
  }
}

class RestoreRowHeights extends Command<readonly (readonly [number, RowMeta | undefined])[]> {
  public execute(sheet: Store): void {
    for (const [r, meta] of this.args) sheet.setRow(r, meta);
  }

  public getUndo(): Command {
    return this;
  }
}
