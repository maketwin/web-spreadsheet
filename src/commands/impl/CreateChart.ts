import { Command } from '../Command';
import type { Store } from '../../store/Store';
import type { ChartSpec, ChartType, ChartAnchor } from '../../charts/types';
import type { RangeAddress } from '../../selection/Range';
import { TOTAL_COLS, TOTAL_ROWS } from '../../renderer/coordinate';

export interface CreateChartArgs extends RangeAddress {
  readonly type: ChartType;
  readonly title?: string | undefined;
  /** Floating-object placement. Legacy callers may omit it — a default anchor is synthesized. */
  readonly anchor?: ChartAnchor | undefined;
}

let chartCounter = 0;

export class CreateChartCommand extends Command<CreateChartArgs> {
  public readonly chartId = `chart-${++chartCounter}`;
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
      anchor: this.args.anchor ?? defaultAnchor(this.args.r2, this.args.c2),
    });
  }

  public getUndo(): Command {
    return new RestoreChart({ chartId: this.chartId, oldChart: this.oldChart });
  }
}

/** Panel-era fallback: park an anchorless chart below/right of its data range. */
function defaultAnchor(r2: number, c2: number): ChartAnchor {
  const r = Math.min(r2 + 1, TOTAL_ROWS - 14);
  const c = Math.min(c2 + 1, TOTAL_COLS - 9);
  return {
    from: { r, c, offX: 0, offY: 0 },
    to: { r: r + 13, c: c + 8, offX: 0, offY: 0 },
  };
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
