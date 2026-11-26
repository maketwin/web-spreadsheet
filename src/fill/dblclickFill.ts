import { MAX_MATERIALIZED_CELLS } from '../util/limits';
import type { Store } from '../store/Store';
import type { RangeAddress } from '../selection/Range';

function hasContent(store: Store, r: number, c: number): boolean {
  const cell = store.getCell(r, c);
  return cell !== undefined && (cell.text !== '' || cell.formula !== undefined);
}

/**
 * Excel double-click-on-fill-handle: fill the selection down as far as the
 * adjacent column(s) still have content — the column left of the selection's
 * first column and right of its last column both bound the fill. Returns the
 * extended target range, or undefined when neither neighbor has data below
 * (no fill happens).
 *
 * The extension stops at the materialization cap: a million-row neighbor
 * column bounds the *address space*, not how many cells one fill writes.
 */
export function doubleClickFillTarget(store: Store, source: RangeAddress, totalRows: number): RangeAddress | undefined {
  const cols = source.c2 - source.c1 + 1;
  const maxRows = Math.max(1, Math.floor(MAX_MATERIALIZED_CELLS / cols));
  const hardBottom = Math.max(source.r2, Math.min(totalRows - 1, source.r1 + maxRows - 1));
  let last = source.r2;
  for (let r = source.r2 + 1; r <= hardBottom; r += 1) {
    const left = source.c1 > 0 ? hasContent(store, r, source.c1 - 1) : false;
    const right = hasContent(store, r, source.c2 + 1);
    if (!left && !right) break;
    last = r;
  }
  if (last === source.r2) return undefined;
  return { r1: source.r1, c1: source.c1, r2: last, c2: source.c2 };
}
