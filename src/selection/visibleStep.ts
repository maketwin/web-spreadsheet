import { TOTAL_COLS, TOTAL_ROWS } from '../renderer/coordinate';
import type { Store } from '../store/Store';
import { Range, type RangeAddress } from './Range';

/**
 * Excel: arrow-key / Enter / Tab movement never lands on a hidden row or
 * column — the step continues in the same direction until a visible cell.
 * When the rest of the grid in that direction is hidden, the selection stays
 * put (returns `current`).
 */
export function skipHiddenCells(store: Store, current: RangeAddress, target: RangeAddress, dr: number, dc: number): RangeAddress {
  let r = target.r1;
  let c = target.c1;
  while (dr !== 0 && r >= 0 && r < TOTAL_ROWS && store.getRow(r)?.hide === true) r += dr;
  while (dc !== 0 && c >= 0 && c < TOTAL_COLS && store.getCol(c)?.hide === true) c += dc;
  if (r < 0 || r >= TOTAL_ROWS || c < 0 || c >= TOTAL_COLS) return current;
  return Range.single(r, c).toAddress();
}

/** True when two addresses describe the same rectangle. */
export function sameRange(a: RangeAddress, b: RangeAddress): boolean {
  return a.r1 === b.r1 && a.c1 === b.c1 && a.r2 === b.r2 && a.c2 === b.c2;
}
