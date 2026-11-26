import { Command } from '../Command';
import type { Store } from '../../store/Store';
import type { AutoFilterState, RowMeta } from '../../types';
import type { RangeAddress } from '../../selection/Range';

export interface SetAutoFilterArgs extends RangeAddress {
  readonly enabled: boolean;
  /** Target sheet; defaults to the active sheet at execution time. */
  readonly sheetId?: string;
}

type RowSnapshot = ReadonlyArray<readonly [number, RowMeta | undefined]>;

export class SetAutoFilterCommand extends Command<SetAutoFilterArgs> {
  private oldFilter: AutoFilterState | undefined;
  private oldRows: RowSnapshot = [];
  private newFilter: AutoFilterState | undefined;
  private newRows: RowSnapshot = [];
  private execSheetId: string | undefined;

  public override kind(): 'setAutoFilter' { return 'setAutoFilter'; }

  /** Retained payload: the pre- and post-state row snapshots (rows with metadata only). */
  public override historyWeight(): number {
    return this.oldRows.length + this.newRows.length;
  }

  public execute(store: Store): void {
    const sid = this.args.sheetId ?? this.execSheetId ?? store.getActiveSheetId();
    this.execSheetId = sid;
    this.oldFilter = store.getAutoFilter(sid);
    this.oldRows = snapshotRows(store, sid);
    if (this.args.enabled) {
      const old = store.getAutoFilter(sid);
      if (old !== undefined) unhideRows(store, old.range.r1 + 1, old.range.r2, sid);
      const { r1, c1, r2, c2 } = this.args;
      store.setAutoFilter({ range: { r1, c1, r2, c2 }, criteria: {} }, sid);
    } else {
      const old = store.getAutoFilter(sid);
      if (old !== undefined) unhideRows(store, old.range.r1 + 1, old.range.r2, sid);
      store.setAutoFilter(undefined, sid);
    }
    this.newFilter = store.getAutoFilter(sid);
    this.newRows = snapshotRows(store, sid);
  }

  public getUndo(): Command {
    return new RestoreAutoFilterCommand({
      filter: this.oldFilter,
      rows: this.oldRows,
      newFilter: this.newFilter,
      newRows: this.newRows,
      ...(this.execSheetId !== undefined ? { sheetId: this.execSheetId } : {}),
    });
  }
}

class RestoreAutoFilterCommand extends Command<RestoreAutoFilterArgs> {
  public execute(store: Store): void {
    restore(store, this.args.filter, this.args.rows, this.args.sheetId);
  }

  public getUndo(): Command {
    return new RestoreAutoFilterCommand({
      filter: this.args.newFilter,
      rows: this.args.newRows,
      newFilter: this.args.filter,
      newRows: this.args.rows,
      ...(this.args.sheetId !== undefined ? { sheetId: this.args.sheetId } : {}),
    });
  }
}

interface RestoreAutoFilterArgs {
  readonly filter: AutoFilterState | undefined;
  readonly rows: RowSnapshot;
  readonly newFilter: AutoFilterState | undefined;
  readonly newRows: RowSnapshot;
  readonly sheetId?: string;
}

function snapshotRows(store: Store, sheetId?: string): RowSnapshot {
  const filter = store.getAutoFilter(sheetId);
  if (filter === undefined) return [];
  // Only rows that carry metadata — a million-row filter range records its
  // hidden rows, not its address space.
  const lo = filter.range.r1 + 1;
  const hi = filter.range.r2;
  return store.getRowEntries(sheetId).filter(([r]) => r >= lo && r <= hi);
}

function unhideRows(store: Store, from: number, to: number, sheetId?: string): void {
  for (const [r, meta] of store.getRowEntries(sheetId)) {
    if (r < from || r > to) continue;
    if (meta.hide === true) store.setRow(r, { ...meta, hide: false }, sheetId);
  }
}

function restore(store: Store, filter: AutoFilterState | undefined, rows: RowSnapshot, sheetId?: string): void {
  const old = store.getAutoFilter(sheetId);
  if (old !== undefined) unhideRows(store, old.range.r1 + 1, old.range.r2, sheetId);
  store.setAutoFilter(filter, sheetId);
  rows.forEach(([r, meta]) => store.setRow(r, meta, sheetId));
}
