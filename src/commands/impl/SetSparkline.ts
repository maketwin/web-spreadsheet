import { Command } from '../Command';
import type { Store } from '../../store/Store';
import type { SparklineSpec, SparklineType } from '../../sparkline/types';
import type { RangeAddress } from '../../selection/Range';

export interface SetSparklineArgs extends RangeAddress {
  readonly type: SparklineType;
  readonly targetRow: number;
  readonly targetCol: number;
}

let sparklineCounter = 0;

export class SetSparklineCommand extends Command<SetSparklineArgs> {
  private sparklineId = `sparkline-${++sparklineCounter}`;
  private oldSparkline: SparklineSpec | undefined;

  public execute(store: Store): void {
    const sparklines = store.getSparklines();
    const existing = sparklines.find((s) => s.row === this.args.targetRow && s.col === this.args.targetCol);
    this.oldSparkline = existing;
    store.addSparkline({
      id: this.sparklineId,
      type: this.args.type,
      range: `${this.args.r1},${this.args.c1}:${this.args.r2},${this.args.c2}`,
      row: this.args.targetRow,
      col: this.args.targetCol,
    });
  }

  public getUndo(): Command {
    return new RestoreSparkline({ sparklineId: this.sparklineId, oldSparkline: this.oldSparkline });
  }
}

interface RestoreSparklineArgs {
  readonly sparklineId: string;
  readonly oldSparkline: SparklineSpec | undefined;
}

class RestoreSparkline extends Command<RestoreSparklineArgs> {
  public execute(store: Store): void {
    store.removeSparkline(this.args.sparklineId);
    if (this.args.oldSparkline !== undefined) store.addSparkline(this.args.oldSparkline);
  }

  public getUndo(): Command {
    throw new Error('RestoreSparkline undo not implemented');
  }
}
