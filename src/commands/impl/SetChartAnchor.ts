import { Command } from '../Command';
import type { Store } from '../../store/Store';
import type { ChartAnchor, ChartSpec } from '../../charts/types';
import { sameAnchor } from '../../charts/geometry';

export interface SetChartAnchorArgs {
  readonly id: string;
  readonly anchor: ChartAnchor;
  /** Target sheet; defaults to the active sheet at execution time. */
  readonly sheetId?: string;
}

/**
 * Move/resize of a floating chart object (drag body, drag a handle, arrow-key
 * nudge). One undo step per gesture — the caller commits on pointer-up.
 */
export class SetChartAnchorCommand extends Command<SetChartAnchorArgs> {
  private oldAnchor: ChartAnchor | undefined;
  private oldSpec: ChartSpec | undefined;
  private execSheetId: string | undefined;

  public execute(store: Store): void {
    const sid = this.args.sheetId ?? this.execSheetId ?? store.getActiveSheetId();
    this.execSheetId = sid;
    const spec = store.getCharts(sid).find((chart) => chart.id === this.args.id);
    if (spec === undefined) return;
    this.oldSpec = spec;
    this.oldAnchor = spec.anchor;
    if (sameAnchor(spec.anchor, this.args.anchor)) return;
    store.addChart({ ...spec, anchor: this.args.anchor }, sid);
  }

  public override isNoOp(): boolean {
    return this.oldSpec === undefined || sameAnchor(this.oldAnchor, this.args.anchor);
  }

  public getUndo(): Command {
    return new RestoreChartAnchor({ id: this.args.id, spec: this.oldSpec, ...(this.execSheetId !== undefined ? { sheetId: this.execSheetId } : {}) });
  }

  public override describe(): string {
    return `移动图表 ${this.args.id}`;
  }
}

interface RestoreChartAnchorArgs {
  readonly id: string;
  readonly spec: ChartSpec | undefined;
  readonly sheetId?: string;
}

class RestoreChartAnchor extends Command<RestoreChartAnchorArgs> {
  public execute(store: Store): void {
    if (this.args.spec !== undefined) store.addChart(this.args.spec, this.args.sheetId);
  }

  public getUndo(): Command {
    throw new Error('RestoreChartAnchor is undo-only');
  }
}
