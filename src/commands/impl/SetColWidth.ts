import { Command } from '../Command';

import type { Store } from '../../store/Store';
import type { ColMeta } from '../../types';

export interface SetColWidthArgs {
  readonly c: number;
  readonly width: number;
}

export class SetColWidth extends Command<SetColWidthArgs> {
  private oldMeta: ColMeta | undefined;

  public execute(store: Store): void {
    const oldMeta = store.getCol(this.args.c);

    this.oldMeta = oldMeta;
    store.setCol(this.args.c, { ...oldMeta, width: this.args.width });
  }

  public getUndo(): Command {
    return new RestoreCol({ c: this.args.c, meta: this.oldMeta });
  }
}

interface RestoreColArgs {
  readonly c: number;
  readonly meta: ColMeta | undefined;
}

class RestoreCol extends Command<RestoreColArgs> {
  public execute(store: Store): void {
    store.setCol(this.args.c, this.args.meta);
  }

  public getUndo(): Command {
    return new SetColWidth({ c: this.args.c, width: this.args.meta?.width ?? 0 });
  }
}
