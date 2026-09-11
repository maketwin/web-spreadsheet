import { Command } from '../Command';
import type { Store } from '../../store/Store';
import type { AutoFilterCriteria, AutoFilterState, RowMeta } from '../../types';
import { FilterService } from '../../filter/FilterService';

export interface SetAutoFilterCriteriaArgs {
  readonly column: number;
  readonly criteria?: AutoFilterCriteria;
  readonly mode: 'set' | 'clearColumn' | 'clearAll';
}

type RowSnapshot = ReadonlyArray<readonly [number, RowMeta | undefined]>;

export class SetAutoFilterCriteriaCommand extends Command<SetAutoFilterCriteriaArgs> {
  private oldFilter: AutoFilterState | undefined;
  private oldRows: RowSnapshot = [];
  private newFilter: AutoFilterState | undefined;
  private newRows: RowSnapshot = [];

  public execute(store: Store): void {
    const filter = store.getAutoFilter();
    if (filter === undefined) return;
    this.oldFilter = filter;
    this.oldRows = snapshotRows(store, filter.range);
    const criteria = { ...filter.criteria };
    if (this.args.mode === 'set' && this.args.criteria !== undefined) criteria[this.args.column] = this.args.criteria;
    else if (this.args.mode === 'clearColumn') delete criteria[this.args.column];
    else if (this.args.mode === 'clearAll') Object.keys(criteria).forEach((key) => delete criteria[Number(key)]);
    const next: AutoFilterState = { ...filter, criteria };
    store.setAutoFilter(next);
    new FilterService(store).applyFilters();
    this.newFilter = store.getAutoFilter();
    this.newRows = snapshotRows(store, filter.range);
  }

  public getUndo(): Command {
    return new RestoreAutoFilterCriteriaCommand({
      filter: this.oldFilter,
      rows: this.oldRows,
      newFilter: this.newFilter,
      newRows: this.newRows,
    });
  }
}

class RestoreAutoFilterCriteriaCommand extends Command<RestoreArgs> {
  public execute(store: Store): void {
    restore(store, this.args.filter, this.args.rows);
  }

  public getUndo(): Command {
    return new RestoreAutoFilterCriteriaCommand({
      filter: this.args.newFilter,
      rows: this.args.newRows,
      newFilter: this.args.filter,
      newRows: this.args.rows,
    });
  }
}

interface RestoreArgs {
  readonly filter: AutoFilterState | undefined;
  readonly rows: RowSnapshot;
  readonly newFilter: AutoFilterState | undefined;
  readonly newRows: RowSnapshot;
}

function snapshotRows(store: Store, range: AutoFilterState['range']): RowSnapshot {
  const rows: Array<readonly [number, RowMeta | undefined]> = [];
  for (let r = range.r1 + 1; r <= range.r2; r += 1) rows.push([r, store.getRow(r)]);
  return rows;
}

function restore(store: Store, filter: AutoFilterState | undefined, rows: RowSnapshot): void {
  const old = store.getAutoFilter();
  if (old !== undefined) for (let r = old.range.r1 + 1; r <= old.range.r2; r += 1) {
    const meta = store.getRow(r);
    if (meta?.hide === true) store.setRow(r, { ...meta, hide: false });
  }
  store.setAutoFilter(filter);
  rows.forEach(([r, meta]) => store.setRow(r, meta));
}
