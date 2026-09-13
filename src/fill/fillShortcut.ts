import { FillRangeCommand } from '../commands/impl/FillRange';
import type { RangeAddress } from '../selection/Range';

/**
 * Excel Ctrl+D / Ctrl+R: fill the selection from its top row / left column;
 * a single cell takes from the cell above / left (no-op at the grid edge).
 * Copy semantics — Ctrl+D never continues a series. Returns the command for
 * the caller's executor (undoable via the shared command pipeline).
 */
export function fillShortcut(range: RangeAddress, dir: 'down' | 'right'): FillRangeCommand | undefined {
  const single = range.r1 === range.r2 && range.c1 === range.c2;
  let source: RangeAddress | undefined;
  if (dir === 'down') {
    source = single
      ? (range.r1 > 0 ? { r1: range.r1 - 1, c1: range.c1, r2: range.r1 - 1, c2: range.c2 } : undefined)
      : { r1: range.r1, c1: range.c1, r2: range.r1, c2: range.c2 };
  } else {
    source = single
      ? (range.c1 > 0 ? { r1: range.r1, c1: range.c1 - 1, r2: range.r2, c2: range.c1 - 1 } : undefined)
      : { r1: range.r1, c1: range.c1, r2: range.r2, c2: range.c1 };
  }
  if (source === undefined) return undefined;
  return new FillRangeCommand({ source, target: range, copy: true });
}
