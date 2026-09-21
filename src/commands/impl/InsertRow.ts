import { Command } from '../Command';
import { TOTAL_ROWS } from '../../renderer/CanvasRenderer';
import { captureSheet, parseKey, restoreSheet, type SheetSnapshot } from './sheetSnapshot';
import { replaceMerges, shiftMergesForInsert } from '../../util/merge';
import { shiftSheetFormulas } from './shiftFormulas';
import { shiftSheetChartAnchors } from '../../charts/anchorShift';

import type { Store } from '../../store/Store';

export interface InsertRowArgs {
  readonly r: number;
  readonly count?: number;
  readonly position?: 'above' | 'below';
  /** Target sheet; defaults to the active sheet at execution time. */
  readonly sheetId?: string;
}

export class InsertRowCommand extends Command<InsertRowArgs> {
  private oldSheet: SheetSnapshot | undefined;
  private execSheetId: string | undefined;

  public execute(store: Store): void {
    const target = this.args.sheetId ?? this.execSheetId ?? store.getActiveSheetId();
    this.execSheetId = target;
    this.oldSheet = captureSheet(store, target);
    const count = normalizeCount(this.args.count);
    const start = this.args.position === 'below' ? this.args.r + 1 : this.args.r;
    const cells = store.getCells(target).map(([key, cell]) => [...parseKey(key), cell] as const);
    cells.filter(([r]) => r >= start).sort((a, b) => b[0] - a[0]).forEach(([r, c, cell]) => {
      store.setCell(r, c, undefined, target);
      // Cells pushed past the grid edge are dropped (the grid is fixed-size).
      if (r + count < TOTAL_ROWS) store.setCell(r + count, c, cell, target);
    });
    for (let r = TOTAL_ROWS - 1; r >= start; r -= 1) {
      if (r + count < TOTAL_ROWS) store.setRow(r + count, store.getRow(r, target), target);
      store.setRow(r, undefined, target);
    }
    replaceMerges(store, shiftMergesForInsert(store.getMerges(target), start, count, 'row'), target);
    shiftSheetFormulas(store, 'row', start, count, target);
    shiftSheetChartAnchors(store, 'insert', 'row', start, count);
  }

  public getUndo(): Command {
    return new RestoreSheetCommand(this.oldSheet, this.execSheetId);
  }
}

interface RestoreSheetArgs {
  readonly snapshot: SheetSnapshot | undefined;
  readonly sheetId?: string;
}

class RestoreSheetCommand extends Command<RestoreSheetArgs> {
  public constructor(snapshot: SheetSnapshot | undefined, sheetId?: string) {
    super({ snapshot, ...(sheetId !== undefined ? { sheetId } : {}) });
  }

  public execute(store: Store): void {
    if (this.args.snapshot !== undefined) restoreSheet(store, this.args.snapshot, this.args.sheetId);
  }

  public getUndo(): Command {
    return new InsertRowCommand({ r: 0, ...(this.args.sheetId !== undefined ? { sheetId: this.args.sheetId } : {}) });
  }
}

function normalizeCount(count: number | undefined): number {
  return Math.max(1, Math.floor(count ?? 1));
}
