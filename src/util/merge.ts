import { parseRange } from './cell';
import { num2alpha } from './alphabet';
import { Range, type RangeAddress } from '../selection/Range';
import type { Store } from '../store/Store';

/**
 * Merge helpers shared by commands, clipboard, selection and rendering.
 * A merge is stored as a range string (e.g. "B2:D4"); its anchor is the
 * top-left cell — the only cell that keeps a value (Excel semantics).
 */

export function rangesIntersect(a: RangeAddress, b: RangeAddress): boolean {
  return a.r1 <= b.r2 && a.r2 >= b.r1 && a.c1 <= b.c2 && a.c2 >= b.c1;
}

export function rangeContains(outer: RangeAddress, inner: RangeAddress): boolean {
  return outer.r1 <= inner.r1 && outer.c1 <= inner.c1 && outer.r2 >= inner.r2 && outer.c2 >= inner.c2;
}

export function sameRange(a: RangeAddress, b: RangeAddress): boolean {
  return a.r1 === b.r1 && a.c1 === b.c1 && a.r2 === b.r2 && a.c2 === b.c2;
}

export function parseMerge(range: string): RangeAddress {
  const { r1, c1, r2, c2 } = parseRange(range);
  return { r1, c1, r2, c2 };
}

export function mergeToString(range: RangeAddress): string {
  const a = Range.normalize(range);
  return `${num2alpha(a.c1)}${a.r1 + 1}:${num2alpha(a.c2)}${a.r2 + 1}`;
}

/**
 * True when both cells sit inside the SAME merge — the interior of a merged
 * cell. Two adjacent merges each cover one cell but keep their shared boundary
 * (Excel draws the grid line between them).
 */
export function coveredBySameMerge(merges: readonly RangeAddress[], rA: number, cA: number, rB: number, cB: number): boolean {
  return merges.some((a) => rA >= a.r1 && rA <= a.r2 && cA >= a.c1 && cA <= a.c2 && rB >= a.r1 && rB <= a.r2 && cB >= a.c1 && cB <= a.c2);
}

/** Swap the sheet's merge set wholesale (row/col insert/delete shifting). */
export function replaceMerges(store: Store, next: readonly string[], sheetId?: string): void {
  store.batch(() => {
    const sid = sheetId ?? store.getActiveSheetId();
    store.getMerges(sid).forEach((m) => store.removeMerge(m, sid));
    next.forEach((m) => store.addMerge(m, sid));
  });
}

/** All merges (as addresses) intersecting the given range. */
export function mergesIntersecting(store: Store, range: RangeAddress): RangeAddress[] {
  const out: RangeAddress[] = [];
  for (const m of store.getMerges()) {
    const addr = parseMerge(m);
    if (rangesIntersect(addr, range)) out.push(addr);
  }
  return out;
}

/**
 * Expand a range so no merge is partially covered (Excel selection snapping):
 * any merge intersecting the range is fully included. Repeats until stable
 * since an expanded range may touch further merges.
 */
export function expandRangeToMerges(store: Store, range: RangeAddress): RangeAddress {
  let cur = Range.normalize(range);
  let changed = true;
  while (changed) {
    changed = false;
    for (const m of store.getMerges()) {
      const addr = parseMerge(m);
      if (rangesIntersect(addr, cur) && !rangeContains(cur, addr)) {
        cur = Range.normalize({
          r1: Math.min(cur.r1, addr.r1),
          c1: Math.min(cur.c1, addr.c1),
          r2: Math.max(cur.r2, addr.r2),
          c2: Math.max(cur.c2, addr.c2),
        });
        changed = true;
      }
    }
  }
  return cur;
}

/**
 * Excel merge warning condition: more than one cell in the range holds a
 * value, so merging keeps only the upper-left one. Counts non-anchor
 * non-empty cells (per merge the anchor keeps its value).
 */
export function mergeConflictCount(store: Store, range: RangeAddress): number {
  const normalized = Range.normalize(range);
  let count = 0;
  for (let r = normalized.r1; r <= normalized.r2; r += 1) {
    for (let c = normalized.c1; c <= normalized.c2; c += 1) {
      if (r === normalized.r1 && c === normalized.c1) continue;
      const cell = store.getCell(r, c);
      // A formula cell counts as data even when its result is an empty string (Excel).
      if (cell !== undefined && (cell.text !== '' || cell.formula !== undefined)) count += 1;
    }
  }
  return count;
}

/**
 * Shift merges for an insertion of `count` rows at index `at` (Excel):
 * merges below move down; a merge straddling the insertion point grows.
 */
export function shiftMergesForInsert(merges: readonly string[], at: number, count: number, axis: 'row' | 'col'): string[] {
  return merges.map((m) => {
    const a = parseMerge(m);
    const [s1, s2] = axis === 'row' ? [a.r1, a.r2] : [a.c1, a.c2];
    let [n1, n2] = [s1, s2];
    if (s1 >= at) n1 = s1 + count;
    if (s2 >= at) n2 = s2 + count;
    if (axis === 'row') return mergeToString({ ...a, r1: n1, r2: n2 });
    return mergeToString({ ...a, c1: n1, c2: n2 });
  });
}

/**
 * Adjust merges for a deletion of rows/cols in [from, to] (Excel): merges
 * after the range shift up; partial overlap shrinks the merge; a merge fully
 * covered by the deletion is removed.
 */
export function shiftMergesForDelete(merges: readonly string[], from: number, to: number, axis: 'row' | 'col'): string[] {
  const out: string[] = [];
  for (const m of merges) {
    const a = parseMerge(m);
    const [s1, s2] = axis === 'row' ? [a.r1, a.r2] : [a.c1, a.c2];
    if (s2 < from) { out.push(m); continue; }
    if (s1 > to) {
      const delta = to - from + 1;
      out.push(axis === 'row' ? mergeToString({ ...a, r1: s1 - delta, r2: s2 - delta }) : mergeToString({ ...a, c1: s1 - delta, c2: s2 - delta }));
      continue;
    }
    // Overlap: shrink by the deleted part; drop when nothing remains.
    const n1 = s1 < from ? s1 : from;
    const n2 = s2 <= to ? from - 1 : s2 - (to - from + 1);
    if (n2 < n1) continue;
    out.push(axis === 'row' ? mergeToString({ ...a, r1: n1, r2: n2 }) : mergeToString({ ...a, c1: n1, c2: n2 }));
  }
  return out;
}
