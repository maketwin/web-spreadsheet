import { Command } from '../Command';
import { captureFeatures, captureMetaBand, RestoreStructuralMoveCommand, type StructuralMoveUndo } from './sheetSnapshot';
import { replaceMerges, shiftMergesForDelete } from '../../util/merge';
import { shiftSheetFormulas } from './shiftFormulas';
import { shiftSheetChartAnchors } from '../../charts/anchorShift';
import { shiftSheetSparklines } from '../../sparkline/shift';

import type { Store } from '../../store/Store';
import type { Cell } from '../../types';

export interface DeleteColArgs {
  readonly c: number;
  readonly count?: number;
  /** Target sheet; defaults to the active sheet at execution time. */
  readonly sheetId?: string;
}

/** Delete `count` whole columns starting at `c` — the column counterpart of DeleteRow. */
export class DeleteColCommand extends Command<DeleteColArgs> {
  private undoData: StructuralMoveUndo | undefined;
  private execSheetId: string | undefined;

  public override kind(): 'deleteCol' { return 'deleteCol'; }

  public override structuralKind(): 'deleteCol' { return 'deleteCol'; }

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
    const start = this.args.c;
    const features = captureFeatures(store, target);
    const metaBand = captureMetaBand(store, 'col', start, target);
    const removed = store.deleteCols(start, count, target);
    // Only columns carrying metadata are touched (each emits at most 2 events):
    // move left-to-right, then clear the origin. Columns without any stay silent.
    const cols = store.getColEntries(target).filter(([c]) => c >= start).sort((a, b) => a[0] - b[0]);
    for (const [c, meta] of cols) {
      if (c >= start + count) store.setCol(c - count, meta, target);
      store.setCol(c, undefined, target);
    }
    replaceMerges(store, shiftMergesForDelete(store.getMerges(target), start, start + count - 1, 'col'), target);
    const rewrites = shiftSheetFormulas(store, 'col', start, -count, target);
    // Rewrite records arrive at post-shift coordinates; undo needs ORIGINAL
    // ones (a surviving formula sat `count` left before the delete).
    for (const entry of rewrites) {
      if (entry[0] === target && entry[2] >= start + count) (entry as unknown as [string, number, number, Cell])[2] += count;
    }
    shiftSheetChartAnchors(store, 'delete', 'col', start, count, target);
    shiftSheetSparklines(store, 'delete', 'col', start, count, target);
    this.undoData = { axis: 'col', kind: 'delete', sheetId: target, spans: [[start, count]], removed, rewrites, metaBand, features };
  }

  public getUndo(): Command {
    return new RestoreStructuralMoveCommand(this.undoData, this);
  }
}

function normalizeCount(count: number | undefined): number {
  return Math.max(1, Math.floor(count ?? 1));
}
