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
  /** Target sheet; defaults to the active sheet at execution time. */
  readonly sheetId?: string;
}

let chartCounter = 0;

export class CreateChartCommand extends Command<CreateChartArgs> {
  public readonly chartId = `chart-${++chartCounter}`;
  private oldChart: ChartSpec | undefined;
  private execSheetId: string | undefined;

  public execute(store: Store): void {
    const sid = this.args.sheetId ?? this.execSheetId ?? store.getActiveSheetId();
    this.execSheetId = sid;
    const charts = store.getCharts(sid);
    const existing = charts.find((c) => c.id === this.chartId);
    this.oldChart = existing;
    store.addChart({
      id: this.chartId,
      type: this.args.type,
      range: `${this.args.r1},${this.args.c1}:${this.args.r2},${this.args.c2}`,
      title: this.args.title,
      anchor: this.args.anchor ?? defaultAnchor(this.args.r2, this.args.c2),
    }, sid);
  }

  public getUndo(): Command {
    return new RestoreChart({ chartId: this.chartId, oldChart: this.oldChart, ...(this.execSheetId !== undefined ? { sheetId: this.execSheetId } : {}) });
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
  readonly sheetId?: string;
}

class RestoreChart extends Command<RestoreChartArgs> {
  public execute(store: Store): void {
    const sid = this.args.sheetId ?? store.getActiveSheetId();
    store.removeChart(this.args.chartId, sid);
    if (this.args.oldChart !== undefined) store.addChart(this.args.oldChart, sid);
  }

  public getUndo(): Command {
    throw new Error('RestoreChart undo not implemented');
  }
}
