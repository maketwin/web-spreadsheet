import { Command } from '../Command';
import type { Store } from '../../store/Store';
import type { ChartAnchor, ChartSpec } from '../../charts/types';
import { sameAnchor } from '../../charts/geometry';

export interface SetChartAnchorArgs {
  readonly id: string;
  readonly anchor: ChartAnchor;
}

/**
 * Move/resize of a floating chart object (drag body, drag a handle, arrow-key
 * nudge). One undo step per gesture — the caller commits on pointer-up.
 */
export class SetChartAnchorCommand extends Command<SetChartAnchorArgs> {
  private oldAnchor: ChartAnchor | undefined;
  private oldSpec: ChartSpec | undefined;

  public execute(store: Store): void {
    const spec = store.getCharts().find((chart) => chart.id === this.args.id);
    if (spec === undefined) return;
    this.oldSpec = spec;
    this.oldAnchor = spec.anchor;
    if (sameAnchor(spec.anchor, this.args.anchor)) return;
    store.addChart({ ...spec, anchor: this.args.anchor });
  }

  public override isNoOp(): boolean {
    return this.oldSpec === undefined || sameAnchor(this.oldAnchor, this.args.anchor);
  }

  public getUndo(): Command {
    return new RestoreChartAnchor({ id: this.args.id, spec: this.oldSpec });
  }

  public override describe(): string {
    return `移动图表 ${this.args.id}`;
  }
}

interface RestoreChartAnchorArgs {
  readonly id: string;
  readonly spec: ChartSpec | undefined;
}

class RestoreChartAnchor extends Command<RestoreChartAnchorArgs> {
  public execute(store: Store): void {
    if (this.args.spec !== undefined) store.addChart(this.args.spec);
  }

  public getUndo(): Command {
    throw new Error('RestoreChartAnchor is undo-only');
  }
}
