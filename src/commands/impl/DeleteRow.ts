import { Command } from '../Command';
import { TOTAL_ROWS } from '../../renderer/CanvasRenderer';
import { captureSheet, parseKey, restoreSheet, type SheetSnapshot } from './sheetSnapshot';

import type { Store } from '../../store/Store';

export interface DeleteRowArgs {
  readonly r: number;
  readonly count?: number;
}

export class DeleteRowCommand extends Command<DeleteRowArgs> {
  private oldSheet: SheetSnapshot | undefined;

  public execute(store: Store): void {
    this.oldSheet = captureSheet(store);
    const count = normalizeCount(this.args.count);
    const start = this.args.r;
    store.getCells().forEach(([key]) => {
      const [r, c] = parseKey(key);
      if (r >= start && r < start + count) store.setCell(r, c, undefined);
    });
    shiftCellsUp(store, start, count);
    for (let r = start; r < TOTAL_ROWS; r += 1) store.setRow(r, store.getRow(r + count));
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
    return new DeleteRowCommand({ r: 0 });
  }
}

function shiftCellsUp(store: Store, start: number, count: number): void {
  const cells = store.getCells().map(([key, cell]) => [...parseKey(key), cell] as const);
  cells.filter(([r]) => r >= start + count).sort((a, b) => a[0] - b[0]).forEach(([r, c, cell]) => {
    store.setCell(r, c, undefined);
    store.setCell(r - count, c, cell);
  });
}

function normalizeCount(count: number | undefined): number {
  return Math.max(1, Math.floor(count ?? 1));
}
