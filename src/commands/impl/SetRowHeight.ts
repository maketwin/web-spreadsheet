import { Command } from '../Command';

import type { Store } from '../../store/Store';
import type { RowMeta } from '../../types';

export interface SetRowHeightArgs {
  readonly r: number;
  readonly height: number;
}

export class SetRowHeight extends Command<SetRowHeightArgs> {
  private oldMeta: RowMeta | undefined;

  public execute(store: Store): void {
    const oldMeta = store.getRow(this.args.r);

    this.oldMeta = oldMeta;
    store.setRow(this.args.r, { ...oldMeta, height: this.args.height });
  }

  public getUndo(): Command {
    return new RestoreRow({ r: this.args.r, meta: this.oldMeta });
  }
}

interface RestoreRowArgs {
  readonly r: number;
  readonly meta: RowMeta | undefined;
}

class RestoreRow extends Command<RestoreRowArgs> {
  public execute(store: Store): void {
    store.setRow(this.args.r, this.args.meta);
  }

  public getUndo(): Command {
    return new SetRowHeight({ r: this.args.r, height: this.args.meta?.height ?? 0 });
  }
}
