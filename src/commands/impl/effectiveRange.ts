import { MAX_MATERIALIZED_CELLS } from '../../util/limits';

import type { Store } from '../../store/Store';
import type { CellRect } from '../../store/SheetData';

/**
 * The part of a selection a per-cell command should walk.
 *
 * A selection the user could materially write in one go (area at or under the
 * materialization cap) is honored verbatim: every cell of it is processed,
 * blanks included, exactly like the pre-scale dense walks did — bolding a
 * 2x2 block on an empty sheet still styles all four cells. Only selections
 * too big to materialize collapse to the used part of the sheet
 * (`Store.limitToData`), so a whole-column command on a 200-row table costs
 * 200 cells, not a million — the address space is not an allocation. Past
 * the cap inside that used part, a command touches only cells that exist
 * (see `withinMaterializationCap` / `forEachCellInRect`).
 */
export function effectiveRange(store: Store, range: CellRect, sheetId?: string): CellRect {
  const r1 = Math.min(range.r1, range.r2);
  const c1 = Math.min(range.c1, range.c2);
  const r2 = Math.max(range.r1, range.r2);
  const c2 = Math.max(range.c1, range.c2);
  if ((r2 - r1 + 1) * (c2 - c1 + 1) <= MAX_MATERIALIZED_CELLS) return { r1, c1, r2, c2 };
  return store.limitToData(range, sheetId);
}

/** True when walking every cell of `rect` stays inside the materialization cap. */
export function withinMaterializationCap(rect: CellRect): boolean {
  return (rect.r2 - rect.r1 + 1) * (rect.c2 - rect.c1 + 1) <= MAX_MATERIALIZED_CELLS;
}
