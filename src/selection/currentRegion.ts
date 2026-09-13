import type { Store } from '../store/Store';
import type { RangeAddress } from './Range';
import { Range } from './Range';
import { rangeSelection, sheetSelection, type Selection } from './Selection';

/** A cell counts as content when it has visible text or a formula (Excel: blanks break the region). */
function hasContent(store: Store, r: number, c: number): boolean {
  const cell = store.getCell(r, c);
  return cell !== undefined && (cell.text !== '' || cell.formula !== undefined);
}

/**
 * Excel "current region": the bounding box of the block of non-empty cells
 * connected to `start` (4-directional), bounded by empty rows/columns.
 * The start cell itself seeds the search even when empty (an empty cell
 * adjacent to data still selects that data). Returns undefined when no
 * connected content exists — callers then select the whole sheet.
 */
export function currentRegion(store: Store, start: { readonly r: number; readonly c: number }, totalRows: number, totalCols: number): RangeAddress | undefined {
  // Sparse flood fill over the stored cells only — never scans the whole grid.
  const seen = new Set<number>();
  const queue: [number, number][] = [[start.r, start.c]];
  seen.add(start.r * totalCols + start.c);
  let found = false;
  let r1 = Infinity, r2 = -Infinity, c1 = Infinity, c2 = -Infinity;
  while (queue.length > 0) {
    const [r, c] = queue.pop()!;
    if (hasContent(store, r, c)) {
      found = true;
      if (r < r1) r1 = r;
      if (r > r2) r2 = r;
      if (c < c1) c1 = c;
      if (c > c2) c2 = c;
    }
    const neighbors: [number, number][] = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]];
    for (const [nr, nc] of neighbors) {
      if (nr < 0 || nr >= totalRows || nc < 0 || nc >= totalCols) continue;
      const key = nr * totalCols + nc;
      if (seen.has(key)) continue;
      // Only expand through content (or the empty start cell); blanks bound the region.
      if (nr === start.r && nc === start.c) continue;
      if (!hasContent(store, nr, nc)) continue;
      seen.add(key);
      queue.push([nr, nc]);
    }
  }
  return found ? Range.normalize({ r1, c1, r2, c2 }) : undefined;
}

function sameRange(a: RangeAddress, b: RangeAddress): boolean {
  return a.r1 === b.r1 && a.c1 === b.c1 && a.r2 === b.r2 && a.c2 === b.c2;
}

/**
 * Excel Ctrl+arrow: jump along one axis to the edge of the data region.
 * - on a content cell inside a run → the run's last cell in that direction;
 * - on a content cell already at its run's edge → the first content cell of the next run;
 * - on an empty cell → the first content cell in that direction;
 * - nothing in that direction → the grid edge.
 */
export function edgeJump(
  store: Store,
  from: { readonly r: number; readonly c: number },
  dr: number,
  dc: number,
  totalRows: number,
  totalCols: number,
): { readonly r: number; readonly c: number } {
  let r = from.r;
  let c = from.c;
  if (dr !== 0) {
    if (hasContent(store, r, c)) {
      while (r + dr >= 0 && r + dr < totalRows && hasContent(store, r + dr, c)) r += dr;
      if (r === from.r) r = scanToContent(store, r, dr, c, true, totalRows, totalCols);
    } else {
      r = scanToContent(store, r, dr, c, true, totalRows, totalCols);
    }
  }
  if (dc !== 0) {
    if (hasContent(store, r, c)) {
      while (c + dc >= 0 && c + dc < totalCols && hasContent(store, r, c + dc)) c += dc;
      if (c === from.c) c = scanToContent(store, c, dc, r, false, totalRows, totalCols);
    } else {
      c = scanToContent(store, c, dc, r, false, totalRows, totalCols);
    }
  }
  return { r, c };
}

/** Advance from `start` by `step` until a content cell or the grid edge. */
function scanToContent(store: Store, start: number, step: number, other: number, rowAxis: boolean, totalRows: number, totalCols: number): number {
  const limit = rowAxis ? totalRows : totalCols;
  let i = start + step;
  while (i >= 0 && i < limit) {
    const has = rowAxis ? hasContent(store, i, other) : hasContent(store, other, i);
    if (has) return i;
    i += step;
  }
  return step > 0 ? limit - 1 : 0;
}

/**
 * Excel Ctrl+A: first press selects the current region around the active cell,
 * second press (region already selected) selects the whole sheet. An isolated
 * active cell (no connected content) selects the whole sheet immediately.
 * Corner-click / menu "select all" should keep using `sheetSelection` directly.
 */
export function excelSelectAll(store: Store, selected: Selection | null, totalRows: number, totalCols: number): Selection {
  const whole = sheetSelection({ r1: 0, c1: 0, r2: totalRows - 1, c2: totalCols - 1 });
  if (selected === null || selected.kind === 'sheet') return whole;
  const active = selected.active;
  const region = currentRegion(store, active, totalRows, totalCols);
  if (region === undefined || sameRange(selected.range, region)) return whole;
  return rangeSelection(region, { r: active.r, c: active.c }, { r: active.r, c: active.c });
}
