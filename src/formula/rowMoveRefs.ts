import type { Store } from '../store/Store';
import type { Cell } from '../types';
import { cellIdCoords, formulaText, remapFormulaRows, type RemapScope } from '../util/cell';

/** [sheetId, r, c, previousCell] for a formula rewritten outside the moved domain. */
export type OutsideRewrite = readonly [string, number, number, Cell | undefined];

export interface MovedRows {
  /** First/last row of the moved block, and the column domain that moved with
   * it. Pinned (filtered-hidden) rows count as part of the block even though
   * they do not appear in the permutation — the mover already handled them. */
  readonly r1: number;
  readonly r2: number;
  readonly c1: number;
  readonly c2: number;
  /** old row → new row for every row that actually moved. */
  readonly permutation: ReadonlyMap<number, number>;
}

/**
 * Single entry point for Excel's "move semantics" reference maintenance:
 * after rows move (sort today; cut/move and structural edits tomorrow),
 * every formula in the workbook that references a moved cell inside the
 * column domain is rewritten to follow its data.
 *
 * - Same-sheet formulas: unscoped refs (and refs explicitly scoped to the
 *   sheet itself) inside the column domain remap; cells inside the moved
 *   block are assumed already handled by the mover and are skipped.
 * - Other sheets: only refs explicitly scoped to the moved sheet remap.
 * All writes happen inside the caller's store batch (call within one).
 */
export function remapRefsForMovedRows(store: Store, moved: MovedRows): OutsideRewrite[] {
  if (!hasRealMove(moved.permutation)) return [];
  const rewrites: OutsideRewrite[] = [];
  const activeId = store.getActiveSheetId();
  const activeName = store.getSheets().find((sh) => sh.id === activeId)?.name;
  for (const sheet of store.getSheets()) {
    const sameSheet = sheet.id === activeId;
    const scope: RemapScope = {
      ...(activeName !== undefined ? { sheetName: activeName } : {}),
      ...(sameSheet ? {} : { scopedOnly: true as const }),
    };
    for (const [id, cell] of store.getCells(sheet.id)) {
      const formula = formulaText(cell);
      if (formula === undefined) continue;
      const at = cellIdCoords(id);
      if (at === null) continue; // ids from getCells are canonical; never write guessed coords
      if (sameSheet && at.r >= moved.r1 && at.r <= moved.r2 && at.c >= moved.c1 && at.c <= moved.c2) continue;
      const remapped = remapFormulaRows(formula, moved.permutation, moved.c1, moved.c2, scope);
      if (remapped !== formula) {
        rewrites.push([sheet.id, at.r, at.c, cell]);
        store.setCell(at.r, at.c, { ...cell, formula: remapped }, sheet.id);
      }
    }
  }
  return rewrites;
}

/** True when at least one row actually changed position. */
function hasRealMove(permutation: ReadonlyMap<number, number>): boolean {
  for (const [from, to] of permutation) if (from !== to) return true;
  return false;
}
