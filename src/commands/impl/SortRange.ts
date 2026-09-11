import { Command } from '../Command';
import type { Store } from '../../store/Store';
import type { Cell } from '../../types';
import { FilterService } from '../../filter/FilterService';
import { sortRowsInPlace } from '../../filter/sortRows';
import type { RangeAddress } from '../../selection/Range';

export interface SortRangeArgs extends RangeAddress {
  readonly sortCol: number;
  readonly direction: 'asc' | 'desc';
}

type CellSnapshot = ReadonlyArray<readonly [number, number, Cell | undefined]>;

export class SortRangeCommand extends Command<SortRangeArgs> {
  private before: CellSnapshot = [];
  private after: CellSnapshot = [];

  public execute(store: Store): void {
    this.before = snapshot(store, this.args);
    sortRowsInPlace(store, this.args.r1, this.args.c1, this.args.r2, this.args.c2, this.args.sortCol, this.args.direction);
    new FilterService(store).applyFilters();
    this.after = snapshot(store, this.args);
  }

  public getUndo(): Command {
    return new RestoreRangeCommand({ range: this.args, before: this.before, after: this.after });
  }
}

class RestoreRangeCommand extends Command<RestoreArgs> {
  public execute(store: Store): void {
    // Batched so formula recalculation sees the fully restored state.
    store.batch(() => restore(store, this.args.before));
  }

  public getUndo(): Command {
    return new RestoreRangeCommand({ range: this.args.range, before: this.args.after, after: this.args.before });
  }
}

interface RestoreArgs {
  readonly range: RangeAddress & { sortCol: number; direction: 'asc' | 'desc' };
  readonly before: CellSnapshot;
  readonly after: CellSnapshot;
}

function snapshot(store: Store, range: RangeAddress): CellSnapshot {
  const rows: Array<readonly [number, number, Cell | undefined]> = [];
  for (let r = range.r1; r <= range.r2; r += 1) {
    for (let c = range.c1; c <= range.c2; c += 1) rows.push([r, c, store.getCell(r, c)]);
  }
  return rows;
}

function restore(store: Store, snapshotData: CellSnapshot): void {
  snapshotData.forEach(([r, c, cell]) => store.setCell(r, c, cell === undefined ? undefined : { ...cell }));
}
