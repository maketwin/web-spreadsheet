import { Command } from '../Command';
import type { Store } from '../../store/Store';
import type { SparklineSpec, SparklineType } from '../../sparkline/types';
import type { RangeAddress } from '../../selection/Range';

export interface SetSparklineArgs extends RangeAddress {
  readonly type: SparklineType;
  readonly targetRow: number;
  readonly targetCol: number;
  /** Target sheet; defaults to the active sheet at execution time. */
  readonly sheetId?: string;
}

let sparklineCounter = 0;

export class SetSparklineCommand extends Command<SetSparklineArgs> {
  private sparklineId = `sparkline-${++sparklineCounter}`;
  private oldSparkline: SparklineSpec | undefined;
  private execSheetId: string | undefined;

  public execute(store: Store): void {
    const sid = this.args.sheetId ?? this.execSheetId ?? store.getActiveSheetId();
    this.execSheetId = sid;
    const sparklines = store.getSparklines(sid);
    const existing = sparklines.find((s) => s.row === this.args.targetRow && s.col === this.args.targetCol);
    this.oldSparkline = existing;
    store.addSparkline({
      id: this.sparklineId,
      type: this.args.type,
      range: `${this.args.r1},${this.args.c1}:${this.args.r2},${this.args.c2}`,
      row: this.args.targetRow,
      col: this.args.targetCol,
    }, sid);
  }

  public getUndo(): Command {
    return new RestoreSparkline({ sparklineId: this.sparklineId, oldSparkline: this.oldSparkline, ...(this.execSheetId !== undefined ? { sheetId: this.execSheetId } : {}) });
  }
}

interface RestoreSparklineArgs {
  readonly sparklineId: string;
  readonly oldSparkline: SparklineSpec | undefined;
  readonly sheetId?: string;
}

class RestoreSparkline extends Command<RestoreSparklineArgs> {
  public execute(store: Store): void {
    const sid = this.args.sheetId ?? store.getActiveSheetId();
    store.removeSparkline(this.args.sparklineId, sid);
    if (this.args.oldSparkline !== undefined) store.addSparkline(this.args.oldSparkline, sid);
  }

  public getUndo(): Command {
    throw new Error('RestoreSparkline undo not implemented');
  }
}
