import { Command } from '../Command';

import type { Store } from '../../store/Store';

export interface SetMergeArgs {
  readonly range: string;
  readonly active: boolean;
}

export class SetMerge extends Command<SetMergeArgs> {
  private wasActive = false;

  public execute(store: Store): void {
    this.wasActive = store.getMerges().includes(this.args.range);

    if (this.args.active) {
      store.addMerge(this.args.range);
    } else {
      store.removeMerge(this.args.range);
    }
  }

  public getUndo(): Command {
    return new RestoreMerge({ range: this.args.range, active: this.wasActive });
  }
}

class RestoreMerge extends Command<SetMergeArgs> {
  public execute(store: Store): void {
    if (this.args.active) {
      store.addMerge(this.args.range);
    } else {
      store.removeMerge(this.args.range);
    }
  }

  public getUndo(): Command {
    return new SetMerge({ range: this.args.range, active: !this.args.active });
  }
}
