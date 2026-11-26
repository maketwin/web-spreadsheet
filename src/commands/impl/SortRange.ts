import { Command } from '../Command';
import type { Store } from '../../store/Store';
import type { Cell } from '../../types';
import { FilterService } from '../../filter/FilterService';
import { mergesIntersecting } from '../../util/merge';
import { sortRowsInPlace } from '../../filter/sortRows';
import type { OutsideRewrite } from '../../formula/rowMoveRefs';
import type { RangeAddress } from '../../selection/Range';

export interface SortRangeArgs extends RangeAddress {
  readonly sortCol: number;
  readonly direction: 'asc' | 'desc';
}

/** [sheetId, r, c, previousCell] — sheets included so cross-sheet formula rewrites undo correctly. */
type CellSnapshot = ReadonlyArray<readonly [string, number, number, Cell | undefined]>;

/**
 * Excel-style row sort. Narrow selections (e.g. a single column) are expanded
 * to the contiguous data block before sorting so formulas and labels stay on
 * the same rows — sorting only column D would otherwise leave 「合计」 with a
 * stray value while its SUM formula lands on another row.
 */
export class SortRangeCommand extends Command<SortRangeArgs> {
  private before: CellSnapshot = [];
  private after: CellSnapshot = [];
  private applied: SortRangeArgs = this.args;

  public override kind(): 'sortRange' { return 'sortRange'; }

  /** Retained payload: the pre-sort and post-sort sparse snapshots (entries each). */
  public override historyWeight(): number {
    return this.before.length + this.after.length;
  }

  public execute(store: Store): void {
    const resolved = new FilterService(store).resolveSortRange(this.args);
    if (resolved === undefined) { this.applied = this.args; this.before = []; this.after = []; return; }
    // Excel refuses to sort a range containing merged cells.
    if (mergesIntersecting(store, resolved).length > 0) { this.applied = this.args; this.before = []; this.after = []; return; }
    this.applied = resolved;
    this.before = snapshot(store, this.applied);
    const outside = sortRowsInPlace(
      store,
      this.applied.r1,
      this.applied.c1,
      this.applied.r2,
      this.applied.c2,
      this.applied.sortCol,
      this.applied.direction,
    );
    new FilterService(store).applyFilters();
    // Outside-range formula rewrites (Excel remaps moved references
    // workbook-wide) join the undo snapshot too.
    this.before = [...this.before, ...outside];
    this.after = [...snapshot(store, this.applied), ...outsideAfter(store, outside)];
  }

  public getUndo(): Command {
    return new RestoreRangeCommand({ range: this.applied, before: this.before, after: this.after });
  }
}

class RestoreRangeCommand extends Command<RestoreArgs> {
  public execute(store: Store): void {
    // Batched so formula recalculation sees the fully restored state.
    restoreSorted(store, this.args.before, this.args.after);
  }

  public getUndo(): Command {
    return new RestoreRangeCommand({ range: this.args.range, before: this.args.after, after: this.args.before });
  }
}

interface RestoreArgs {
  readonly range: SortRangeArgs;
  readonly before: CellSnapshot;
  readonly after: CellSnapshot;
}

/**
 * When the sort target is a single column, expand to the CurrentRegion
 * columns (Excel "expand the selection") so formulas stay with their row
 * labels. Multi-column ranges are left as given.
 */
/** Sparse snapshot: only the stored cells of the sorted range — sorting a
 * whole column walks the stored cells, not the address space. */
function snapshot(store: Store, range: RangeAddress): CellSnapshot {
  const sheetId = store.getActiveSheetId();
  const rows: Array<readonly [string, number, number, Cell | undefined]> = [];
  store.forEachCellInRect(range, (r, c, cell) => rows.push([sheetId, r, c, cell]), sheetId);
  return rows;
}

/** Post-sort states of the outside-range rewrites, for redo-undo symmetry. */
function outsideAfter(store: Store, outside: readonly OutsideRewrite[]): CellSnapshot {
  return outside.map(([sheetId, r, c]) => [sheetId, r, c, store.getCell(r, c, sheetId)] as const);
}

function restore(store: Store, snapshotData: CellSnapshot): void {
  snapshotData.forEach(([sheetId, r, c, cell]) => store.setCell(r, c, cell === undefined ? undefined : { ...cell }, sheetId));
}

/** Undo of a sparse sort: restore every recorded pre-sort cell, then clear
 * the positions the sort filled that had no cell before (a cell from a
 * blank-source row can land on a position the pre-state left empty). The
 * two position sets are disjoint, so no batch is needed here. */
function restoreSorted(store: Store, before: CellSnapshot, after: CellSnapshot): void {
  restore(store, before);
  const beforePos = new Set(before.map(([sheetId, r, c]) => `${sheetId}:${r}:${c}`));
  after.forEach(([sheetId, r, c]) => {
    if (beforePos.has(`${sheetId}:${r}:${c}`)) return;
    store.setCell(r, c, undefined, sheetId);
  });
}
