import { Command } from '../Command';
import { TOTAL_COLS } from '../../renderer/CanvasRenderer';
import { captureSheet, parseKey, restoreSheet, type SheetSnapshot } from './sheetSnapshot';
import { replaceMerges, shiftMergesForInsert } from '../../util/merge';
import { shiftSheetFormulas } from './shiftFormulas';

import type { Store } from '../../store/Store';

export interface InsertColArgs {
  readonly c: number;
  readonly count?: number;
  readonly position?: 'left' | 'right';
}

export class InsertColCommand extends Command<InsertColArgs> {
  private oldSheet: SheetSnapshot | undefined;

  public execute(store: Store): void {
    this.oldSheet = captureSheet(store);
    const count = normalizeCount(this.args.count);
    const start = this.args.position === 'right' ? this.args.c + 1 : this.args.c;
    const cells = store.getCells().map(([key, cell]) => [...parseKey(key), cell] as const);
    cells.filter(([, c]) => c >= start).sort((a, b) => b[1] - a[1]).forEach(([r, c, cell]) => {
      store.setCell(r, c, undefined);
      // Cells pushed past the grid edge are dropped (the grid is fixed-size).
      if (c + count < TOTAL_COLS) store.setCell(r, c + count, cell);
    });
    for (let c = TOTAL_COLS - 1; c >= start; c -= 1) {
      if (c + count < TOTAL_COLS) store.setCol(c + count, store.getCol(c));
      store.setCol(c, undefined);
    }
    replaceMerges(store, shiftMergesForInsert(store.getMerges(), start, count, 'col'));
    shiftSheetFormulas(store, 'col', start, count);
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
    return new InsertColCommand({ c: 0 });
  }
}

function normalizeCount(count: number | undefined): number {
  return Math.max(1, Math.floor(count ?? 1));
}
