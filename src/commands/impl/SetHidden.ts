import { Command } from '../Command';
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

/** Excel 隐藏行: collapses the rows to zero height (renderer + scroller honor the meta flag). */
export class SetRowsHiddenCommand extends Command<SetRowsHiddenArgs> {
  private oldMetas: readonly (RowMeta | undefined)[] = [];
  private execSheetId: string | undefined;

  public execute(store: Store): void {
    const target = this.args.sheetId ?? this.execSheetId ?? store.getActiveSheetId();
    this.execSheetId = target;
    const metas: (RowMeta | undefined)[] = [];
    for (let r = this.args.r1; r <= this.args.r2; r += 1) {
      const meta = store.getRow(r, target);
      metas.push(meta);
      store.setRow(r, { ...meta, hide: this.args.hidden }, target);
    }
    this.oldMetas = metas;
  }

  public getUndo(): Command {
    return new RestoreRowsMeta({ r1: this.args.r1, metas: this.oldMetas.slice(), ...(this.execSheetId !== undefined ? { sheetId: this.execSheetId } : {}) });
  }

  public override describe(): string {
    return this.args.hidden ? `隐藏行 ${this.args.r1 + 1}-${this.args.r2 + 1}` : `取消隐藏行 ${this.args.r1 + 1}-${this.args.r2 + 1}`;
  }
}

interface RestoreRowsMetaArgs {
  readonly r1: number;
  readonly metas: readonly (RowMeta | undefined)[];
  readonly sheetId?: string;
}

class RestoreRowsMeta extends Command<RestoreRowsMetaArgs> {
  public execute(store: Store): void {
    this.args.metas.forEach((meta, i) => store.setRow(this.args.r1 + i, meta, this.args.sheetId));
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

/** Excel 隐藏列: collapses the columns to zero width. */
export class SetColsHiddenCommand extends Command<SetColsHiddenArgs> {
  private oldMetas: readonly (ColMeta | undefined)[] = [];
  private execSheetId: string | undefined;

  public execute(store: Store): void {
    const target = this.args.sheetId ?? this.execSheetId ?? store.getActiveSheetId();
    this.execSheetId = target;
    const metas: (ColMeta | undefined)[] = [];
    for (let c = this.args.c1; c <= this.args.c2; c += 1) {
      const meta = store.getCol(c, target);
      metas.push(meta);
      store.setCol(c, { ...meta, hide: this.args.hidden }, target);
    }
    this.oldMetas = metas;
  }

  public getUndo(): Command {
    return new RestoreColsMeta({ c1: this.args.c1, metas: this.oldMetas.slice(), ...(this.execSheetId !== undefined ? { sheetId: this.execSheetId } : {}) });
  }

  public override describe(): string {
    return this.args.hidden ? `隐藏列 ${this.args.c1 + 1}-${this.args.c2 + 1}` : `取消隐藏列 ${this.args.c1 + 1}-${this.args.c2 + 1}`;
  }
}

interface RestoreColsMetaArgs {
  readonly c1: number;
  readonly metas: readonly (ColMeta | undefined)[];
  readonly sheetId?: string;
}

class RestoreColsMeta extends Command<RestoreColsMetaArgs> {
  public execute(store: Store): void {
    this.args.metas.forEach((meta, i) => store.setCol(this.args.c1 + i, meta, this.args.sheetId));
  }

  public getUndo(): Command {
    throw new Error('RestoreColsMeta is undo-only');
  }
}
