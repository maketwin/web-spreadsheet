import { Command } from '../Command';

import type { Store } from '../../store/Store';
import type { ColMeta } from '../../types';

export interface SetColWidthArgs {
  readonly c: number;
  readonly width: number;
  /** Target sheet; defaults to the active sheet at execution time. */
  readonly sheetId?: string;
}

export class SetColWidth extends Command<SetColWidthArgs> {
  private oldMeta: ColMeta | undefined;
  private execSheetId: string | undefined;

  public execute(store: Store): void {
    const target = this.args.sheetId ?? this.execSheetId ?? store.getActiveSheetId();
    this.execSheetId = target;
    const oldMeta = store.getCol(this.args.c, target);

    this.oldMeta = oldMeta;
    store.setCol(this.args.c, { ...oldMeta, width: this.args.width }, target);
  }

  public getUndo(): Command {
    return new RestoreCol({ c: this.args.c, meta: this.oldMeta, ...(this.execSheetId !== undefined ? { sheetId: this.execSheetId } : {}) });
  }
}

interface RestoreColArgs {
  readonly c: number;
  readonly meta: ColMeta | undefined;
  readonly sheetId?: string;
}

class RestoreCol extends Command<RestoreColArgs> {
  public execute(store: Store): void {
    store.setCol(this.args.c, this.args.meta, this.args.sheetId);
  }

  public getUndo(): Command {
    return new SetColWidth({ c: this.args.c, width: this.args.meta?.width ?? 0, ...(this.args.sheetId !== undefined ? { sheetId: this.args.sheetId } : {}) });
  }
}
