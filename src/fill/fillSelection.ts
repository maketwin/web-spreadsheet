import type { CellPatch } from '../commands/impl/SetRangeValues';
import { shiftFormula } from '../commands/impl/FillRange';
import type { RangeAddress } from '../selection/Range';
import { valueFromText } from '../util/cell';

export interface CellAddress { readonly r: number; readonly c: number }

/**
 * Excel Ctrl+Enter: the typed text lands in every cell of the selection.
 * Formulas are anchored at the active cell and each other cell gets its
 * relative references shifted by its offset from the anchor (Excel shows
 * per-cell adjusted formulas). Explicit `undefined` keys fully replace the
 * target cell so stale formula/value remnants never survive.
 */
export function fillSelectionPatches(range: RangeAddress, anchor: CellAddress, text: string): CellPatch[][] {
  const isFormula = text.startsWith('=');
  const value = valueFromText(text);
  const out: CellPatch[][] = [];
  for (let r = range.r1; r <= range.r2; r += 1) {
    const line: CellPatch[] = [];
    for (let c = range.c1; c <= range.c2; c += 1) {
      const shifted = isFormula && (r !== anchor.r || c !== anchor.c) ? shiftFormula(text, r - anchor.r, c - anchor.c) : undefined;
      line.push({
        text: shifted ?? text,
        formula: isFormula ? shifted ?? text : undefined,
        value: isFormula ? undefined : value,
      });
    }
    out.push(line);
  }
  return out;
}
