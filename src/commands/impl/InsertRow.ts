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
}

export class InsertRowCommand extends Command<InsertRowArgs> {
  private oldSheet: SheetSnapshot | undefined;

  public execute(store: Store): void {
    this.oldSheet = captureSheet(store);
    const count = normalizeCount(this.args.count);
    const start = this.args.position === 'below' ? this.args.r + 1 : this.args.r;
    const cells = store.getCells().map(([key, cell]) => [...parseKey(key), cell] as const);
    cells.filter(([r]) => r >= start).sort((a, b) => b[0] - a[0]).forEach(([r, c, cell]) => {
      store.setCell(r, c, undefined);
      // Cells pushed past the grid edge are dropped (the grid is fixed-size).
      if (r + count < TOTAL_ROWS) store.setCell(r + count, c, cell);
    });
    for (let r = TOTAL_ROWS - 1; r >= start; r -= 1) {
      if (r + count < TOTAL_ROWS) store.setRow(r + count, store.getRow(r));
      store.setRow(r, undefined);
    }
    replaceMerges(store, shiftMergesForInsert(store.getMerges(), start, count, 'row'));
    shiftSheetFormulas(store, 'row', start, count);
    shiftSheetChartAnchors(store, 'insert', 'row', start, count);
  }

  public getUndo(): Command {
    return new RestoreSheetCommand(this.oldSheet);
  }
}

class RestoreSheetCommand extends Command<SheetSnapshot | undefined> {
  public execute(store: Store): void {
    if (this.args !== undefined) restoreSheet(store, this.args);
  }

  public getUndo(): Command {
    return new InsertRowCommand({ r: 0 });
  }
}

function normalizeCount(count: number | undefined): number {
  return Math.max(1, Math.floor(count ?? 1));
}
