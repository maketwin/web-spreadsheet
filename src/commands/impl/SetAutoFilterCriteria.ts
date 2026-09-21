import { Command } from '../Command';
import type { Store } from '../../store/Store';
import type { AutoFilterCriteria, AutoFilterState, RowMeta } from '../../types';
import { FilterService } from '../../filter/FilterService';

export interface SetAutoFilterCriteriaArgs {
  readonly column: number;
  readonly criteria?: AutoFilterCriteria;
  readonly mode: 'set' | 'clearColumn' | 'clearAll';
  /** Target sheet; defaults to the active sheet at execution time. */
  readonly sheetId?: string;
}

type RowSnapshot = ReadonlyArray<readonly [number, RowMeta | undefined]>;

export class SetAutoFilterCriteriaCommand extends Command<SetAutoFilterCriteriaArgs> {
  private oldFilter: AutoFilterState | undefined;
  private oldRows: RowSnapshot = [];
  private newFilter: AutoFilterState | undefined;
  private newRows: RowSnapshot = [];
  private execSheetId: string | undefined;

  public execute(store: Store): void {
    const sid = this.args.sheetId ?? this.execSheetId ?? store.getActiveSheetId();
    this.execSheetId = sid;
    const filter = store.getAutoFilter(sid);
    if (filter === undefined) return;
    this.oldFilter = filter;
    this.oldRows = snapshotRows(store, filter.range, sid);
    const criteria = { ...filter.criteria };
    if (this.args.mode === 'set' && this.args.criteria !== undefined) criteria[this.args.column] = this.args.criteria;
    else if (this.args.mode === 'clearColumn') delete criteria[this.args.column];
    else if (this.args.mode === 'clearAll') Object.keys(criteria).forEach((key) => delete criteria[Number(key)]);
    const next: AutoFilterState = { ...filter, criteria };
    store.setAutoFilter(next, sid);
    new FilterService(store).applyFilters();
    this.newFilter = store.getAutoFilter(sid);
    this.newRows = snapshotRows(store, filter.range, sid);
  }

  public getUndo(): Command {
    return new RestoreAutoFilterCriteriaCommand({
      filter: this.oldFilter,
      rows: this.oldRows,
      newFilter: this.newFilter,
      newRows: this.newRows,
      ...(this.execSheetId !== undefined ? { sheetId: this.execSheetId } : {}),
    });
  }
}

class RestoreAutoFilterCriteriaCommand extends Command<RestoreArgs> {
  public execute(store: Store): void {
    restore(store, this.args.filter, this.args.rows, this.args.sheetId);
  }

  public getUndo(): Command {
    return new RestoreAutoFilterCriteriaCommand({
      filter: this.args.newFilter,
      rows: this.args.newRows,
      newFilter: this.args.filter,
      newRows: this.args.rows,
      ...(this.args.sheetId !== undefined ? { sheetId: this.args.sheetId } : {}),
    });
  }
}

interface RestoreArgs {
  readonly filter: AutoFilterState | undefined;
  readonly rows: RowSnapshot;
  readonly newFilter: AutoFilterState | undefined;
  readonly newRows: RowSnapshot;
  readonly sheetId?: string;
}

function snapshotRows(store: Store, range: AutoFilterState['range'], sheetId?: string): RowSnapshot {
  const rows: Array<readonly [number, RowMeta | undefined]> = [];
  for (let r = range.r1 + 1; r <= range.r2; r += 1) rows.push([r, store.getRow(r, sheetId)]);
  return rows;
}

function restore(store: Store, filter: AutoFilterState | undefined, rows: RowSnapshot, sheetId?: string): void {
  const old = store.getAutoFilter(sheetId);
  if (old !== undefined) for (let r = old.range.r1 + 1; r <= old.range.r2; r += 1) {
    const meta = store.getRow(r, sheetId);
    if (meta?.hide === true) store.setRow(r, { ...meta, hide: false }, sheetId);
  }
  store.setAutoFilter(filter, sheetId);
  rows.forEach(([r, meta]) => store.setRow(r, meta, sheetId));
}
