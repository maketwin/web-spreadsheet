import { Command } from '../Command';

import type { Store } from '../../store/Store';
import type { RowMeta } from '../../types';

export interface SetRowHeightArgs {
  readonly r: number;
  readonly height: number;
  /** Target sheet; defaults to the active sheet at execution time. */
  readonly sheetId?: string;
}

export class SetRowHeight extends Command<SetRowHeightArgs> {
  private oldMeta: RowMeta | undefined;
  private execSheetId: string | undefined;

  public execute(store: Store): void {
    const target = this.args.sheetId ?? this.execSheetId ?? store.getActiveSheetId();
    this.execSheetId = target;
    const oldMeta = store.getRow(this.args.r, target);

    this.oldMeta = oldMeta;
    store.setRow(this.args.r, { ...oldMeta, height: this.args.height }, target);
  }

  public getUndo(): Command {
    return new RestoreRow({ r: this.args.r, meta: this.oldMeta, ...(this.execSheetId !== undefined ? { sheetId: this.execSheetId } : {}) });
  }
}

interface RestoreRowArgs {
  readonly r: number;
  readonly meta: RowMeta | undefined;
  readonly sheetId?: string;
}

class RestoreRow extends Command<RestoreRowArgs> {
  public execute(store: Store): void {
    store.setRow(this.args.r, this.args.meta, this.args.sheetId);
  }

  public getUndo(): Command {
    return new SetRowHeight({ r: this.args.r, height: this.args.meta?.height ?? 0, ...(this.args.sheetId !== undefined ? { sheetId: this.args.sheetId } : {}) });
  }
}
