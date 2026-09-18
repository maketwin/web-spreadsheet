import { Command } from '../Command';
import type { Store } from '../../store/Store';
import type { ChartSpec } from '../../charts/types';

export interface RemoveChartArgs {
  readonly id: string;
}

/** Delete a chart from the active sheet (undo restores it). */
export class RemoveChartCommand extends Command<RemoveChartArgs> {
  private oldChart: ChartSpec | undefined;

  public execute(store: Store): void {
    this.oldChart = store.getCharts().find((chart) => chart.id === this.args.id);
    store.removeChart(this.args.id);
  }

  /** Removing an id that no longer exists changed nothing — keep it out of history. */
  public override isNoOp(): boolean {
    return this.oldChart === undefined;
  }

  public getUndo(): Command {
    return new RestoreRemovedChart({ chart: this.oldChart });
  }

  public override describe(): string {
    return `删除图表 ${this.args.id}`;
  }
}

interface RestoreRemovedChartArgs {
  readonly chart: ChartSpec | undefined;
}

class RestoreRemovedChart extends Command<RestoreRemovedChartArgs> {
  public execute(store: Store): void {
    if (this.args.chart !== undefined) store.addChart(this.args.chart);
  }

  public getUndo(): Command {
    throw new Error('RestoreRemovedChart is undo-only');
  }
}
