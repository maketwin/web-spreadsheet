import { Command } from '../Command';
import type { Store } from '../../store/Store';
import type { ChartSpec } from '../../charts/types';

export interface RemoveChartArgs {
  readonly id: string;
  /** Target sheet; defaults to the active sheet at execution time. */
  readonly sheetId?: string;
}

/** Delete a chart from the active sheet (undo restores it). */
export class RemoveChartCommand extends Command<RemoveChartArgs> {
  private oldChart: ChartSpec | undefined;
  private execSheetId: string | undefined;

  public execute(store: Store): void {
    const sid = this.args.sheetId ?? this.execSheetId ?? store.getActiveSheetId();
    this.execSheetId = sid;
    this.oldChart = store.getCharts(sid).find((chart) => chart.id === this.args.id);
    store.removeChart(this.args.id, sid);
  }

  /** Removing an id that no longer exists changed nothing — keep it out of history. */
  public override isNoOp(): boolean {
    return this.oldChart === undefined;
  }

  public getUndo(): Command {
    return new RestoreRemovedChart({ chart: this.oldChart, ...(this.execSheetId !== undefined ? { sheetId: this.execSheetId } : {}) });
  }

  public override describe(): string {
    return `删除图表 ${this.args.id}`;
  }
}

interface RestoreRemovedChartArgs {
  readonly chart: ChartSpec | undefined;
  readonly sheetId?: string;
}

class RestoreRemovedChart extends Command<RestoreRemovedChartArgs> {
  public execute(store: Store): void {
    if (this.args.chart !== undefined) store.addChart(this.args.chart, this.args.sheetId);
  }

  public getUndo(): Command {
    throw new Error('RestoreRemovedChart is undo-only');
  }
}
