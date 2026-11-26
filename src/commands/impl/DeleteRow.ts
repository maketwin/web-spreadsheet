import { Command } from '../Command';
import { captureFeatures, captureMetaBand, RestoreStructuralMoveCommand, type StructuralMoveUndo } from './sheetSnapshot';
import { replaceMerges, shiftMergesForDelete } from '../../util/merge';
import { sameRowGroups } from './sheetSnapshot';
import { shiftRowGroupsForDelete } from '../../outline/rowGroupShift';
import { shiftSheetFormulas } from './shiftFormulas';
import { shiftSheetChartAnchors } from '../../charts/anchorShift';
import { shiftSheetSparklines } from '../../sparkline/shift';

import type { Store } from '../../store/Store';
import type { Cell } from '../../types';

export interface DeleteRowArgs {
  readonly r: number;
  readonly count?: number;
  /** Target sheet; defaults to the active sheet at execution time. */
  readonly sheetId?: string;
}

/**
 * Delete `count` whole rows starting at `r`. The band is taken out and the
 * rows below shift up as one piece through `Store.deleteRows` (one
 * `structure` event, spill shadows dropped); metadata, merges, formulas and
 * features shift as before. Undo carries no band snapshot — the taken cells
 * come back through `bulkSetCells`, the rewritten formulas' pre-move objects
 * return to their original coordinates.
 */
export class DeleteRowCommand extends Command<DeleteRowArgs> {
  private undoData: StructuralMoveUndo | undefined;
  private execSheetId: string | undefined;

  public override kind(): 'deleteRow' { return 'deleteRow'; }

  public override structuralKind(): 'deleteRow' { return 'deleteRow'; }

  /** Retained payload: taken cells + rewritten formulas + metadata band + features. */
  public override historyWeight(): number {
    const undo = this.undoData;
    if (undo === undefined) return 0;
    return undo.removed.length + undo.rewrites.length + undo.metaBand.length + undo.features.merges.length + 2;
  }

  public execute(store: Store): void {
    const target = this.args.sheetId ?? this.execSheetId ?? store.getActiveSheetId();
    this.execSheetId = target;
    const count = normalizeCount(this.args.count);
    const start = this.args.r;
    const features = captureFeatures(store, target);
    const metaBand = captureMetaBand(store, 'row', start, target);
    const removed = store.deleteRows(start, count, target);
    // Only rows carrying metadata are touched (each emits at most 2 events):
    // move top-down, then clear the origin. Rows without any stay silent.
    const rows = store.getRowEntries(target).filter(([r]) => r >= start).sort((a, b) => a[0] - b[0]);
    for (const [r, meta] of rows) {
      if (r >= start + count) store.setRow(r - count, meta, target);
      store.setRow(r, undefined, target);
    }
    replaceMerges(store, shiftMergesForDelete(store.getMerges(target), start, start + count - 1, 'row'), target);
    const nextGroups = shiftRowGroupsForDelete(store.getRowGroups(target), start, start + count - 1);
    if (!sameRowGroups(nextGroups, store.getRowGroups(target))) store.setRowGroups(nextGroups, target);
    const rewrites = shiftSheetFormulas(store, 'row', start, -count, target);
    // Rewrite records arrive at post-shift coordinates; undo needs ORIGINAL
    // ones (a surviving formula sat `count` lower before the delete).
    for (const entry of rewrites) {
      if (entry[0] === target && entry[1] >= start + count) (entry as unknown as [string, number, number, Cell])[1] += count;
    }
    shiftSheetChartAnchors(store, 'delete', 'row', start, count, target);
    shiftSheetSparklines(store, 'delete', 'row', start, count, target);
    this.undoData = { axis: 'row', kind: 'delete', sheetId: target, spans: [[start, count]], removed, rewrites, metaBand, features };
  }

  public getUndo(): Command {
    return new RestoreStructuralMoveCommand(this.undoData, this);
  }
}

function normalizeCount(count: number | undefined): number {
  return Math.max(1, Math.floor(count ?? 1));
}
