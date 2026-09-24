import { Command } from '../Command';
import { TOTAL_COLS } from '../../renderer/CanvasRenderer';
import { captureSheet, parseKey, restoreSheet, type SheetSnapshot } from './sheetSnapshot';
import { replaceMerges, shiftMergesForInsert } from '../../util/merge';
import { shiftSheetFormulas } from './shiftFormulas';
import { shiftSheetChartAnchors } from '../../charts/anchorShift';

import type { Store } from '../../store/Store';

export interface InsertColArgs {
  readonly c: number;
  readonly count?: number;
  readonly position?: 'left' | 'right';
  /** Target sheet; defaults to the active sheet at execution time. */
  readonly sheetId?: string;
}

export class InsertColCommand extends Command<InsertColArgs> {
  private oldSheet: SheetSnapshot | undefined;
  private execSheetId: string | undefined;

  public execute(store: Store): void {
    const target = this.args.sheetId ?? this.execSheetId ?? store.getActiveSheetId();
    this.execSheetId = target;
    this.oldSheet = captureSheet(store, target);
    const count = normalizeCount(this.args.count);
    const start = this.args.position === 'right' ? this.args.c + 1 : this.args.c;
    const cells = store.getCells(target).map(([key, cell]) => [...parseKey(key), cell] as const);
    cells.filter(([, c]) => c >= start).sort((a, b) => b[1] - a[1]).forEach(([r, c, cell]) => {
      store.setCell(r, c, undefined, target);
      // Cells pushed past the grid edge are dropped (the grid is fixed-size).
      if (c + count < TOTAL_COLS) store.setCell(r, c + count, cell, target);
    });
    for (let c = TOTAL_COLS - 1; c >= start; c -= 1) {
      if (c + count < TOTAL_COLS) store.setCol(c + count, store.getCol(c, target), target);
      store.setCol(c, undefined, target);
    }
    replaceMerges(store, shiftMergesForInsert(store.getMerges(target), start, count, 'col'), target);
    shiftSheetFormulas(store, 'col', start, count, target);
    shiftSheetChartAnchors(store, 'insert', 'col', start, count, target);
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
    return new InsertColCommand({ c: 0, ...(this.args.sheetId !== undefined ? { sheetId: this.args.sheetId } : {}) });
  }
}

function normalizeCount(count: number | undefined): number {
  return Math.max(1, Math.floor(count ?? 1));
}
