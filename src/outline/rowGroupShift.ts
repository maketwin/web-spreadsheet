import type { RowGroupDef } from '../store/SheetData';

/**
 * Pure interval bookkeeping for row groups across row insert/delete (the
 * counterparts of shiftMergesForInsert/Delete in util/merge). Deliberately
 * dependency-free so the command layer can import it without dragging UI
 * modules in (rowGroups.ts itself imports antd for the collapse toasts).
 *
 * Excel semantics, mirroring the merge rules: an insertion at a group's top
 * edge pushes the group down; inside it, the group grows. A deletion shifts
 * groups below up and shrinks partially-overlapping ones; a fully covered
 * group is dropped.
 */

export function shiftRowGroupsForInsert(groups: readonly RowGroupDef[], at: number, count: number): RowGroupDef[] {
  return groups.map((g) => ({
    start: g.start >= at ? g.start + count : g.start,
    end: g.end >= at ? g.end + count : g.end,
  }));
}

export function shiftRowGroupsForDelete(groups: readonly RowGroupDef[], from: number, to: number): RowGroupDef[] {
  const delta = to - from + 1;
  const out: RowGroupDef[] = [];
  for (const g of groups) {
    if (g.end < from) { out.push(g); continue; }
    if (g.start > to) { out.push({ start: g.start - delta, end: g.end - delta }); continue; }
    // Overlap: shrink by the deleted part; drop when nothing remains.
    const start = g.start < from ? g.start : from;
    const end = g.end <= to ? from - 1 : g.end - delta;
    if (end < start) continue;
    out.push({ start, end });
  }
  return out;
}
