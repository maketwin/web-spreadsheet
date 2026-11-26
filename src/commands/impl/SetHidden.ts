import { Command } from '../Command';
import { withinMaterializationCap } from './effectiveRange';
import type { Store } from '../../store/Store';
import type { ColMeta, RowMeta } from '../../types';

export interface SetRowsHiddenArgs {
  /** Inclusive row span to (un)hide. */
  readonly r1: number;
  readonly r2: number;
  readonly hidden: boolean;
  /** Target sheet; defaults to the active sheet at execution time. */
  readonly sheetId?: string;
}

type MetaSnapshot = ReadonlyArray<readonly [number, RowMeta | undefined]>;

/**
 * Rows worth writing inside [lo, hi]: for spans that fit the materialization
 * cap every row of the span (as before — hiding a small block must hide it
 * even where nothing is stored); for huge spans only the rows that exist —
 * stored cells or row metadata — plus the span's first row, so hiding a
 * whole column of rows never creates a million row records.
 */
function rowsToTouch(store: Store, lo: number, hi: number, sheetId: string): number[] {
  if (hi - lo + 1 <= 0) return [];
  if (withinMaterializationCap({ r1: lo, c1: 0, r2: hi, c2: 0 })) {
    const all: number[] = [];
    for (let r = lo; r <= hi; r += 1) all.push(r);
    return all;
  }
  const set = new Set<number>([lo]);
  const bounds = store.getUsedBounds(sheetId);
  if (bounds !== undefined && bounds.r1 <= hi && bounds.r2 >= lo) {
    store.forEachCellInRect({ r1: Math.max(lo, bounds.r1), c1: bounds.c1, r2: Math.min(hi, bounds.r2), c2: bounds.c2 }, (r) => set.add(r), sheetId);
  }
  for (const [r] of store.getRowEntries(sheetId)) {
    if (r >= lo && r <= hi) set.add(r);
  }
  return [...set].sort((a, b) => a - b);
}

/** Excel 隐藏行: collapses the rows to zero height (renderer + scroller honor the meta flag). */
export class SetRowsHiddenCommand extends Command<SetRowsHiddenArgs> {
  private oldMetas: MetaSnapshot = [];
  private execSheetId: string | undefined;

  public override kind(): 'setRowsHidden' { return 'setRowsHidden'; }

  /** Retained payload: one meta snapshot per touched row (the row count). */
  public override historyWeight(): number {
    return this.oldMetas.length;
  }

  public execute(store: Store): void {
    const target = this.args.sheetId ?? this.execSheetId ?? store.getActiveSheetId();
    this.execSheetId = target;
    const lo = Math.min(this.args.r1, this.args.r2);
    const hi = Math.max(this.args.r1, this.args.r2);
    const rows = rowsToTouch(store, lo, hi, target);
    this.oldMetas = rows.map((r) => [r, store.getRow(r, target)] as const);
    for (const r of rows) {
      const meta = store.getRow(r, target);
      store.setRow(r, { ...meta, hide: this.args.hidden }, target);
    }
  }

  public getUndo(): Command {
    return new RestoreRowsMeta({ metas: this.oldMetas.slice(), ...(this.execSheetId !== undefined ? { sheetId: this.execSheetId } : {}) });
  }

  public override describe(): string {
    return this.args.hidden ? `隐藏行 ${this.args.r1 + 1}-${this.args.r2 + 1}` : `取消隐藏行 ${this.args.r1 + 1}-${this.args.r2 + 1}`;
  }
}

interface RestoreRowsMetaArgs {
  readonly metas: MetaSnapshot;
  readonly sheetId?: string;
}

class RestoreRowsMeta extends Command<RestoreRowsMetaArgs> {
  public execute(store: Store): void {
    this.args.metas.forEach(([r, meta]) => store.setRow(r, meta, this.args.sheetId));
  }

  public getUndo(): Command {
    throw new Error('RestoreRowsMeta is undo-only');
  }
}

export interface SetColsHiddenArgs {
  /** Inclusive column span to (un)hide. */
  readonly c1: number;
  readonly c2: number;
  readonly hidden: boolean;
  /** Target sheet; defaults to the active sheet at execution time. */
  readonly sheetId?: string;
}

/** Columns worth writing inside [lo, hi] — same rule as rows (the column axis
 * never exceeds the grid width, so small spans stay byte-for-byte dense). */
function colsToTouch(store: Store, lo: number, hi: number, sheetId: string): number[] {
  if (hi - lo + 1 <= 0) return [];
  if (withinMaterializationCap({ r1: 0, c1: lo, r2: 0, c2: hi })) {
    const all: number[] = [];
    for (let c = lo; c <= hi; c += 1) all.push(c);
    return all;
  }
  const set = new Set<number>([lo]);
  const bounds = store.getUsedBounds(sheetId);
  if (bounds !== undefined && bounds.c1 <= hi && bounds.c2 >= lo) {
    store.forEachCellInRect({ r1: bounds.r1, c1: Math.max(lo, bounds.c1), r2: bounds.r2, c2: Math.min(hi, bounds.c2) }, (_r, c) => set.add(c), sheetId);
  }
  for (const [c] of store.getColEntries(sheetId)) {
    if (c >= lo && c <= hi) set.add(c);
  }
  return [...set].sort((a, b) => a - b);
}

/** Excel 隐藏列: collapses the columns to zero width. */
export class SetColsHiddenCommand extends Command<SetColsHiddenArgs> {
  private oldMetas: ReadonlyArray<readonly [number, ColMeta | undefined]> = [];
  private execSheetId: string | undefined;

  public override kind(): 'setColsHidden' { return 'setColsHidden'; }

  /** Retained payload: one meta snapshot per touched column (the column count). */
  public override historyWeight(): number {
    return this.oldMetas.length;
  }

  public execute(store: Store): void {
    const target = this.args.sheetId ?? this.execSheetId ?? store.getActiveSheetId();
    this.execSheetId = target;
    const lo = Math.min(this.args.c1, this.args.c2);
    const hi = Math.max(this.args.c1, this.args.c2);
    const cols = colsToTouch(store, lo, hi, target);
    this.oldMetas = cols.map((c) => [c, store.getCol(c, target)] as const);
    for (const c of cols) {
      const meta = store.getCol(c, target);
      store.setCol(c, { ...meta, hide: this.args.hidden }, target);
    }
  }

  public getUndo(): Command {
    return new RestoreColsMeta({ metas: this.oldMetas.slice(), ...(this.execSheetId !== undefined ? { sheetId: this.execSheetId } : {}) });
  }

  public override describe(): string {
    return this.args.hidden ? `隐藏列 ${this.args.c1 + 1}-${this.args.c2 + 1}` : `取消隐藏列 ${this.args.c1 + 1}-${this.args.c2 + 1}`;
  }
}

interface RestoreColsMetaArgs {
  readonly metas: ReadonlyArray<readonly [number, ColMeta | undefined]>;
  readonly sheetId?: string;
}

class RestoreColsMeta extends Command<RestoreColsMetaArgs> {
  public execute(store: Store): void {
    this.args.metas.forEach(([c, meta]) => store.setCol(c, meta, this.args.sheetId));
  }

  public getUndo(): Command {
    throw new Error('RestoreColsMeta is undo-only');
  }
}
