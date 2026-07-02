import { Command } from '../Command';
import type { Store } from '../../store/Store';
import type { ChartSpec, ChartType } from '../../charts/types';
import type { RangeAddress } from '../../selection/Range';

export interface CreateChartArgs extends RangeAddress {
  readonly type: ChartType;
  readonly title?: string | undefined;
}

let chartCounter = 0;

export class CreateChartCommand extends Command<CreateChartArgs> {
  private chartId = `chart-${++chartCounter}`;
  private oldChart: ChartSpec | undefined;

  public execute(store: Store): void {
    const charts = store.getCharts();
    const existing = charts.find((c) => c.id === this.chartId);
    this.oldChart = existing;
    store.addChart({
      id: this.chartId,
      type: this.args.type,
      range: `${this.args.r1},${this.args.c1}:${this.args.r2},${this.args.c2}`,
      title: this.args.title,
    });
  }

  public getUndo(): Command {
    return new RestoreChart({ chartId: this.chartId, oldChart: this.oldChart });
  }
}

interface RestoreChartArgs {
  readonly chartId: string;
  readonly oldChart: ChartSpec | undefined;
}

class RestoreChart extends Command<RestoreChartArgs> {
  public execute(store: Store): void {
    store.removeChart(this.args.chartId);
    if (this.args.oldChart !== undefined) store.addChart(this.args.oldChart);
  }

  public getUndo(): Command {
    throw new Error('RestoreChart undo not implemented');
  }
}
