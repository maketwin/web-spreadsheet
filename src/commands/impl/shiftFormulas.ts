import { formulaText, shiftAxis, shiftFormulaCols, shiftFormulaRows, shiftInternalRange } from '../../util/cell';
import { TOTAL_COLS } from '../../renderer/coordinate';

import type { Store } from '../../store/Store';
import type { AutoFilterCriteria } from '../../types';

/**
 * Excel inserts/deletes rewrite references workbook-wide after the active
 * sheet's rows or columns move: unscoped refs in the target sheet's own
 * formulas shift, and `Target!A5`-scoped refs shift in every sheet's
 * formulas. Recalculation follows from the emitted cell events.
 *
 * Non-formula structures move too, Excel-style: named ranges (on any sheet,
 * when they refer to the target sheet), and the target sheet's conditional
 * formats, validation rules, and autofilter range. A structure whose range
 * is fully deleted is removed, matching Excel dropping the definition.
 */
export function shiftSheetFormulas(store: Store, axis: 'row' | 'col', start: number, count: number, sheetId?: string): void {
  const targetId = sheetId ?? store.getActiveSheetId();
  const targetName = store.getSheets().find((sheet) => sheet.id === targetId)?.name;
  if (targetName === undefined) return;
  for (const { id } of store.getSheets()) {
    const scopedOnly = id !== targetId;
    const scope = { sheetName: targetName, scopedOnly };
    for (const [key, cell] of store.getCells(id)) {
      const formula = formulaText(cell);
      if (formula === undefined) continue;
      const next = axis === 'row'
        ? shiftFormulaRows(formula, start, count, scope)
        : shiftFormulaCols(formula, start, count, scope);
      if (next === formula) continue;
      const [r, c] = key.split(',').map(Number);
      store.setCell(r ?? 0, c ?? 0, { ...cell, formula: next }, id);
    }
  }
  shiftSheetStructures(store, targetId, axis, start, count);
}

/** Named ranges / conditional formats / validation / autofilter follow the moved rows or cols. */
function shiftSheetStructures(store: Store, targetId: string, axis: 'row' | 'col', start: number, count: number): void {
  for (const { id } of store.getSheets()) {
    // A named range moves when it refers to the target sheet — either
    // explicitly (def.sheetId) or by living on it.
    for (const [name, def] of store.getNamedRanges(id)) {
      if ((def.sheetId ?? id) !== targetId) continue;
      const next = shiftInternalRange(def.range, axis, start, count);
      if (next === def.range) continue;
      store.removeNamedRange(name, id);
      if (next !== null) store.setNamedRange(name, { ...def, range: next }, id);
    }
    // Conditional formats, validation rules, and the autofilter are
    // sheet-local: only the target sheet's move.
    if (id !== targetId) continue;
    for (const [range, rules] of store.getConditionalRules(id)) {
      const next = shiftInternalRange(range, axis, start, count);
      if (next === range) continue;
      store.removeConditionalRule(range, id);
      if (next !== null) store.setConditionalRule(next, rules, id);
    }
    for (const [range, rule] of store.getValidationRules(id)) {
      const next = shiftInternalRange(range, axis, start, count);
      if (next === range) continue;
      store.removeValidationRule(range, id);
      if (next !== null) store.setValidationRule(next, rule, id);
    }
    shiftAutoFilter(store, id, axis, start, count);
  }
}

function shiftAutoFilter(store: Store, sheetId: string, axis: 'row' | 'col', start: number, count: number): void {
  const af = store.getAutoFilter(sheetId);
  if (af === undefined) return;
  const { r1, c1, r2, c2 } = af.range;
  const next = shiftInternalRange(`${r1},${c1}:${r2},${c2}`, axis, start, count);
  if (next === null) {
    store.setAutoFilter(undefined, sheetId);
    return;
  }
  const [lo, hi] = next.split(':').map((part) => part.split(',').map(Number));
  // Filter criteria are keyed by column: re-key through a column shift and
  // drop criteria whose column was deleted (Excel clears that filter).
  let criteria = af.criteria;
  if (axis === 'col') {
    const moved: Record<number, AutoFilterCriteria> = {};
    for (const [key, value] of Object.entries(af.criteria)) {
      const mapped = shiftAxis(Number(key), start, count);
      if (mapped >= 0) moved[Math.min(mapped, TOTAL_COLS - 1)] = value;
    }
    criteria = moved;
  }
  store.setAutoFilter({ range: { r1: lo?.[0] ?? 0, c1: lo?.[1] ?? 0, r2: hi?.[0] ?? 0, c2: hi?.[1] ?? 0 }, criteria }, sheetId);
}
