import { Command } from '../Command';
import type { Store } from '../../store/Store';
import type { AutoFilterState, RowMeta } from '../../types';
import type { RangeAddress } from '../../selection/Range';

export interface SetAutoFilterArgs extends RangeAddress {
  readonly enabled: boolean;
}

type RowSnapshot = ReadonlyArray<readonly [number, RowMeta | undefined]>;

export class SetAutoFilterCommand extends Command<SetAutoFilterArgs> {
  private oldFilter: AutoFilterState | undefined;
  private oldRows: RowSnapshot = [];
  private newFilter: AutoFilterState | undefined;
  private newRows: RowSnapshot = [];

  public execute(store: Store): void {
    this.oldFilter = store.getAutoFilter();
    this.oldRows = snapshotRows(store);
    if (this.args.enabled) {
      const old = store.getAutoFilter();
      if (old !== undefined) unhideRows(store, old.range.r1 + 1, old.range.r2);
      store.setAutoFilter({ range: { ...this.args }, criteria: {} });
    } else {
      const old = store.getAutoFilter();
      if (old !== undefined) unhideRows(store, old.range.r1 + 1, old.range.r2);
      store.setAutoFilter(undefined);
    }
    this.newFilter = store.getAutoFilter();
    this.newRows = snapshotRows(store);
  }

  public getUndo(): Command {
    return new RestoreAutoFilterCommand({
      filter: this.oldFilter,
      rows: this.oldRows,
      newFilter: this.newFilter,
      newRows: this.newRows,
    });
  }
}

class RestoreAutoFilterCommand extends Command<RestoreAutoFilterArgs> {
  public execute(store: Store): void {
    restore(store, this.args.filter, this.args.rows);
  }

  public getUndo(): Command {
    return new RestoreAutoFilterCommand({
      filter: this.args.newFilter,
      rows: this.args.newRows,
      newFilter: this.args.filter,
      newRows: this.args.rows,
    });
  }
}

interface RestoreAutoFilterArgs {
  readonly filter: AutoFilterState | undefined;
  readonly rows: RowSnapshot;
  readonly newFilter: AutoFilterState | undefined;
  readonly newRows: RowSnapshot;
}

function snapshotRows(store: Store): RowSnapshot {
  const filter = store.getAutoFilter();
  const rows: Array<readonly [number, RowMeta | undefined]> = [];
  if (filter === undefined) return rows;
  for (let r = filter.range.r1 + 1; r <= filter.range.r2; r += 1) rows.push([r, store.getRow(r)]);
  return rows;
}

function unhideRows(store: Store, from: number, to: number): void {
  for (let r = from; r <= to; r += 1) {
    const meta = store.getRow(r);
    if (meta?.hide === true) store.setRow(r, { ...meta, hide: false });
  }
}

function restore(store: Store, filter: AutoFilterState | undefined, rows: RowSnapshot): void {
  const old = store.getAutoFilter();
  if (old !== undefined) unhideRows(store, old.range.r1 + 1, old.range.r2);
  store.setAutoFilter(filter);
  rows.forEach(([r, meta]) => store.setRow(r, meta));
}
