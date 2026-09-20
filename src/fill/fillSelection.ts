import type { CellPatch } from '../commands/impl/SetRangeValues';
import { shiftFormula } from '../commands/impl/FillRange';
import type { RangeAddress } from '../selection/Range';
import type { RichTextRun } from '../types';
import { valueFromText } from '../util/cell';
import { isRich, normalizeRuns } from '../util/richText';

export interface CellAddress { readonly r: number; readonly c: number }

/**
 * Excel Ctrl+Enter: the typed text lands in every cell of the selection.
 * Formulas are anchored at the active cell and each other cell gets its
 * relative references shifted by its offset from the anchor.
 * Non-formula fills optionally carry `runs` (Excel keeps character formatting).
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
  const out: CellPatch[][] = [];
  for (let r = range.r1; r <= range.r2; r += 1) {
    const line: CellPatch[] = [];
    for (let c = range.c1; c <= range.c2; c += 1) {
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
