import type { CellPatch } from '../commands/impl/SetRangeValues';
import { shiftFormula } from '../formula/refRewrite';
import type { RangeAddress } from '../selection/Range';
import type { RichTextRun } from '../types';
import { valueFromText } from '../util/cell';
import { MAX_MATERIALIZED_CELLS } from '../util/limits';
import { isRich, normalizeRuns } from '../util/richText';

export interface CellAddress { readonly r: number; readonly c: number }

/**
 * Excel Ctrl+Enter: the typed text lands in every cell of the selection.
 * Formulas are anchored at the active cell and each other cell gets its
 * relative references shifted by its offset from the anchor.
 * Non-formula fills optionally carry `runs` (Excel keeps character formatting).
 *
 * Ctrl+Enter on a whole-column selection stops at the materialization cap:
 * the matrix is clipped from the top-left anchor so the caller's placement
 * at (range.r1, range.c1) stays aligned.
 */
export function fillSelectionPatches(
  range: RangeAddress,
  anchor: CellAddress,
  text: string,
  runs?: readonly RichTextRun[],
): CellPatch[][] {
  const isFormula = text.startsWith('=');
  const value = valueFromText(text);
  const rich = !isFormula && isRich(runs)
    ? normalizeRuns(runs.map((run) => ({
      text: run.text,
      ...(run.style !== undefined ? { style: { ...run.style } } : {}),
    })))
    : undefined;
  // Clip the extent (never the anchor) to the materialization cap.
  const cols = range.c2 - range.c1 + 1;
  const maxRows = Math.max(1, Math.floor(MAX_MATERIALIZED_CELLS / cols));
  const r2 = Math.min(range.r2, range.r1 + maxRows - 1);
  const rows = r2 - range.r1 + 1;
  const maxCols = Math.max(1, Math.floor(MAX_MATERIALIZED_CELLS / rows));
  const c2 = Math.min(range.c2, range.c1 + maxCols - 1);
  const out: CellPatch[][] = [];
  for (let r = range.r1; r <= r2; r += 1) {
    const line: CellPatch[] = [];
    for (let c = range.c1; c <= c2; c += 1) {
      const shifted = isFormula && (r !== anchor.r || c !== anchor.c) ? shiftFormula(text, r - anchor.r, c - anchor.c) : undefined;
      if (isFormula) {
        line.push({ text: shifted ?? text, formula: shifted ?? text, value: undefined });
        continue;
      }
      if (rich !== undefined) {
        line.push({
          text,
          formula: undefined,
          value,
          richText: rich.map((run) => ({
            text: run.text,
            ...(run.style !== undefined ? { style: { ...run.style } } : {}),
          })),
        });
      } else {
        line.push({ text, formula: undefined, value });
      }
    }
    out.push(line);
  }
  return out;
}
