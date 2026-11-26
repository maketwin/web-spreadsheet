import { Command } from '../Command';
import { TOTAL_COLS } from '../../util/gridSize';
import { captureFeatures, captureMetaBand, RestoreStructuralMoveCommand, type StructuralMoveUndo } from './sheetSnapshot';
import { replaceMerges, shiftMergesForInsert } from '../../util/merge';
import { shiftSheetFormulas } from './shiftFormulas';
import { shiftSheetChartAnchors } from '../../charts/anchorShift';
import { shiftSheetSparklines } from '../../sparkline/shift';

import type { Store } from '../../store/Store';
import type { Cell } from '../../types';

export interface InsertColArgs {
  readonly c: number;
  readonly count?: number;
  readonly position?: 'left' | 'right';
  /** Target sheet; defaults to the active sheet at execution time. */
  readonly sheetId?: string;
}

/** Insert whole columns left of `c` — the column counterpart of InsertRow. */
export class InsertColCommand extends Command<InsertColArgs> {
  private undoData: StructuralMoveUndo | undefined;
  private execSheetId: string | undefined;

  public override kind(): 'insertCol' { return 'insertCol'; }

  public override structuralKind(): 'insertCol' { return 'insertCol'; }

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
    const start = this.args.position === 'right' ? this.args.c + 1 : this.args.c;
    const features = captureFeatures(store, target);
    const metaBand = captureMetaBand(store, 'col', start, target);
    const removed = store.insertCols(start, count, target);
    // Only columns carrying metadata are touched (each emits at most 2 events):
    // shift right-to-left, then clear the origin. Columns without any stay silent.
    const cols = store.getColEntries(target).filter(([c]) => c >= start).sort((a, b) => b[0] - a[0]);
    for (const [c, meta] of cols) {
      // Metadata pushed past the grid edge is dropped (the grid is fixed-size).
      if (c + count < TOTAL_COLS) store.setCol(c + count, meta, target);
      store.setCol(c, undefined, target);
    }
    replaceMerges(store, shiftMergesForInsert(store.getMerges(target), start, count, 'col'), target);
    const rewrites = shiftSheetFormulas(store, 'col', start, count, target);
    // Rewrite records arrive at post-shift coordinates; undo needs ORIGINAL
    // ones (a moved formula sat `count` left, unmoved ones stay put).
    for (const entry of rewrites) {
      if (entry[0] === target && entry[2] >= start) (entry as unknown as [string, number, number, Cell])[2] -= count;
    }
    shiftSheetChartAnchors(store, 'insert', 'col', start, count, target);
    shiftSheetSparklines(store, 'insert', 'col', start, count, target);
    this.undoData = { axis: 'col', kind: 'insert', sheetId: target, spans: [[start, count]], removed, rewrites, metaBand, features };
  }

  public getUndo(): Command {
    return new RestoreStructuralMoveCommand(this.undoData, this);
  }
}

function normalizeCount(count: number | undefined): number {
  return Math.max(1, Math.floor(count ?? 1));
}
