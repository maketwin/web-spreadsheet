import { expandRangeToMerges, parseMerge, rangesIntersect } from '../util/merge';
import { Range, type RangeAddress } from './Range';
import { cellSelection, rangeSelection, type Selection } from './Selection';
import { TOTAL_COLS, TOTAL_ROWS } from '../renderer/CanvasRenderer';
import type { Store } from '../store/Store';

/**
 * Excel merge-aware selection:
 * - clicking anywhere inside a merged cell selects the whole merge;
 * - shift-extend and drag selections snap their edges to merge boundaries;
 * - arrow keys step over a merge as if it were a single cell.
 */

/** Plain click: when the cell is covered by a merge, select the whole merge. */
export function snapClickSelection(store: Store, r: number, c: number): Selection {
  const merge = store.getMergeAt(r, c);
  if (merge === undefined) return cellSelection(r, c);
  const addr = parseMerge(merge);
  return rangeSelection(addr, { r: addr.r1, c: addr.c1 }, { r: addr.r1, c: addr.c1 });
}

/** Snap a cell/range selection's edges to merge boundaries (drag, shift+click). */
export function snapRangeSelection(store: Store, selection: Selection): Selection {
  if (selection.kind !== 'cell' && selection.kind !== 'range') return selection;
  const expanded = expandRangeToMerges(store, selection.range);
  // Anchor inside a merge snaps to the merge anchor (Excel anchors drags at the merge).
  const anchorMerge = store.getMergeAt(selection.anchor.r, selection.anchor.c);
  const anchor = anchorMerge === undefined ? selection.anchor : (() => { const a = parseMerge(anchorMerge); return { r: a.r1, c: a.c1 }; })();
  return rangeSelection(expanded, anchor, selection.active);
}

/**
 * Arrow-key step. `target` is the naive single-cell target; `dr`/`dc` is the
 * step direction. Moving into a merge selects the whole merge; moving out of
 * the current merge jumps past its far edge (Excel treats a merged cell as
 * one navigation stop).
 */
export function resolveArrowTarget(store: Store, current: RangeAddress, target: RangeAddress, dr: number, dc: number): RangeAddress {
  const merge = store.getMergeAt(target.r1, target.c1);
  if (merge === undefined) return target;
  const addr = parseMerge(merge);
  if (rangesIntersect(addr, current)) {
    // Stepping out of the current merge: land just past its far edge.
    const r = dr > 0 ? addr.r2 + 1 : dr < 0 ? addr.r1 - 1 : target.r1;
    const c = dc > 0 ? addr.c2 + 1 : dc < 0 ? addr.c1 - 1 : target.c1;
    const clamped = Range.single(
      Math.max(0, Math.min(r, TOTAL_ROWS - 1)),
      Math.max(0, Math.min(c, TOTAL_COLS - 1)),
    ).toAddress();
    // The landing cell may itself be merged (adjacent merges) — step into it.
    return store.getMergeAt(clamped.r1, clamped.c1) === undefined ? clamped : parseMerge(store.getMergeAt(clamped.r1, clamped.c1)!);
  }
  // Stepping into a merge from outside: select it whole.
  return addr;
}

/** Step direction of a keyboard move (sign of target minus current origin). */
export function moveDirection(current: RangeAddress, target: RangeAddress): { dr: number; dc: number } {
  return { dr: Math.sign(target.r1 - current.r1), dc: Math.sign(target.c1 - current.c1) };
}

/** True when the selection is exactly one merge (Enter/Tab leave it like a single cell). */
export function isExactlyOneMerge(store: Store, range: RangeAddress): boolean {
  const merge = store.getMergeAt(range.r1, range.c1);
  if (merge === undefined) return false;
  const addr = parseMerge(merge);
  return addr.r1 === range.r1 && addr.c1 === range.c1 && addr.r2 === range.r2 && addr.c2 === range.c2;
}

/**
 * Excel: F2 / double-click / typing always edits the merge anchor. Returns
 * the cell to edit and, when merged, the full merge range to keep selected.
 */
export function resolveEditAnchor(store: Store, r: number, c: number): { readonly anchor: { r: number; c: number }; readonly merge: RangeAddress | undefined } {
  const merge = store.getMergeAt(r, c);
  if (merge === undefined) return { anchor: { r, c }, merge: undefined };
  const addr = parseMerge(merge);
  return { anchor: { r: addr.r1, c: addr.c1 }, merge: addr };
}

