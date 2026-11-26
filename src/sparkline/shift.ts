import { shiftInternalRange } from '../util/rangeNotation';
import { TOTAL_COLS, TOTAL_ROWS } from '../util/gridSize';

import type { Store } from '../store/Store';
import type { SparklineSpec } from './types';

/**
 * Structural row/col edits drag sparklines with their cells (Excel "move and
 * size with cells"): the host cell translates with the shift and the source
 * range grows/shrinks with it. A sparkline whose host cell is deleted, pushed
 * past the grid edge, or whose whole source range is deleted is removed.
 */
export function shiftSheetSparklines(store: Store, kind: 'insert' | 'delete', axis: 'row' | 'col', start: number, count: number, sheetId?: string): void {
  const sid = sheetId ?? store.getActiveSheetId();
  for (const spec of store.getSparklines(sid)) {
    const next = shiftSparklineSpec(spec, kind, axis, start, count);
    if (next === spec) continue;
    if (next === null) store.removeSparkline(spec.id, sid);
    else store.addSparkline(next, sid);
  }
}

/** One sparkline through an insert/delete; null when it no longer has a place. */
export function shiftSparklineSpec(spec: SparklineSpec, kind: 'insert' | 'delete', axis: 'row' | 'col', start: number, count: number): SparklineSpec | null {
  const max = axis === 'row' ? TOTAL_ROWS : TOTAL_COLS;
  const pos = axis === 'row' ? spec.row : spec.col;
  let mapped: number;
  if (kind === 'insert') {
    mapped = pos >= start ? pos + count : pos;
    if (mapped >= max) return null; // pushed past the fixed grid edge, like a cell
  } else {
    if (pos >= start + count) mapped = pos - count;
    else if (pos >= start) return null; // host cell is inside the deleted band
    else mapped = pos;
  }
  // shiftInternalRange takes a signed count (negative deletes), like shiftSheetFormulas.
  const range = shiftInternalRange(spec.range, axis, start, kind === 'insert' ? count : -count);
  if (range === null) return null; // source range fully deleted
  if (mapped === pos && range === spec.range) return spec;
  return axis === 'row' ? { ...spec, range, row: mapped } : { ...spec, range, col: mapped };
}
