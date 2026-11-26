import { Command } from '../Command';
import { TOTAL_ROWS } from '../../util/gridSize';
import { captureFeatures, captureMetaBand, RestoreStructuralMoveCommand, type StructuralMoveUndo } from './sheetSnapshot';
import { replaceMerges, shiftMergesForInsert } from '../../util/merge';
import { sameRowGroups } from './sheetSnapshot';
import { shiftRowGroupsForInsert } from '../../outline/rowGroupShift';
import { shiftSheetFormulas } from './shiftFormulas';
import { shiftSheetChartAnchors } from '../../charts/anchorShift';
import { shiftSheetSparklines } from '../../sparkline/shift';

import type { Store } from '../../store/Store';
import type { Cell } from '../../types';

export interface InsertRowArgs {
  readonly r: number;
  readonly count?: number;
  readonly position?: 'above' | 'below';
  /** Target sheet; defaults to the active sheet at execution time. */
  readonly sheetId?: string;
}

/**
 * Insert whole rows above `r`. Cells move as one piece through
 * `Store.insertRows` (one `structure` event, no per-cell events); metadata,
 * merges, formulas and features shift as before. Undo carries no band
 * snapshot — only the dropped cells, the rewritten formulas, the thin
 * metadata band and the small features.
 */
export class InsertRowCommand extends Command<InsertRowArgs> {
  private undoData: StructuralMoveUndo | undefined;
  private execSheetId: string | undefined;

  public override kind(): 'insertRow' { return 'insertRow'; }

  public override structuralKind(): 'insertRow' { return 'insertRow'; }

  /** Retained payload: dropped cells + rewritten formulas + metadata band + features. */
  public override historyWeight(): number {
    const undo = this.undoData;
    if (undo === undefined) return 0;
    return undo.removed.length + undo.rewrites.length + undo.metaBand.length + undo.features.merges.length + 2;
  }

  public execute(store: Store): void {
    const target = this.args.sheetId ?? this.execSheetId ?? store.getActiveSheetId();
    this.execSheetId = target;
    const count = normalizeCount(this.args.count);
    const start = this.args.position === 'below' ? this.args.r + 1 : this.args.r;
    const features = captureFeatures(store, target);
    const metaBand = captureMetaBand(store, 'row', start, target);
    const removed = store.insertRows(start, count, target);
    // Only rows carrying metadata are touched (each emits at most 2 events):
    // shift bottom-up, then clear the origin. Rows without any stay silent.
    const rows = store.getRowEntries(target).filter(([r]) => r >= start).sort((a, b) => b[0] - a[0]);
    for (const [r, meta] of rows) {
      // Metadata pushed past the grid edge is dropped (the grid is fixed-size).
      if (r + count < TOTAL_ROWS) store.setRow(r + count, meta, target);
      store.setRow(r, undefined, target);
    }
    replaceMerges(store, shiftMergesForInsert(store.getMerges(target), start, count, 'row'), target);
    const nextGroups = shiftRowGroupsForInsert(store.getRowGroups(target), start, count);
    if (!sameRowGroups(nextGroups, store.getRowGroups(target))) store.setRowGroups(nextGroups, target);
    const rewrites = shiftSheetFormulas(store, 'row', start, count, target);
    // Rewrite records arrive at post-shift coordinates; undo needs ORIGINAL
    // ones (a moved formula sat `count` lower, unmoved ones stay put).
    for (const entry of rewrites) {
      if (entry[0] === target && entry[1] >= start) (entry as unknown as [string, number, number, Cell])[1] -= count;
    }
    shiftSheetChartAnchors(store, 'insert', 'row', start, count, target);
    shiftSheetSparklines(store, 'insert', 'row', start, count, target);
    this.undoData = { axis: 'row', kind: 'insert', sheetId: target, spans: [[start, count]], removed, rewrites, metaBand, features };
  }

  public getUndo(): Command {
    return new RestoreStructuralMoveCommand(this.undoData, this);
  }
}

function normalizeCount(count: number | undefined): number {
  return Math.max(1, Math.floor(count ?? 1));
}
