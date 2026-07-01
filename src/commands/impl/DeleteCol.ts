import { Command } from '../Command';
import { TOTAL_COLS } from '../../renderer/CanvasRenderer';
import { captureSheet, parseKey, restoreSheet, type SheetSnapshot } from './sheetSnapshot';

import type { Store } from '../../store/Store';

export interface DeleteColArgs {
  readonly c: number;
  readonly count?: number;
}

export class DeleteColCommand extends Command<DeleteColArgs> {
  private oldSheet: SheetSnapshot | undefined;

  public execute(store: Store): void {
    this.oldSheet = captureSheet(store);
    const count = normalizeCount(this.args.count);
    const start = this.args.c;
    store.getCells().forEach(([key]) => {
      const [r, c] = parseKey(key);
      if (c >= start && c < start + count) store.setCell(r, c, undefined);
    });
    shiftCellsLeft(store, start, count);
    for (let c = start; c < TOTAL_COLS; c += 1) store.setCol(c, store.getCol(c + count));
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
    return new DeleteColCommand({ c: 0 });
  }
}

function shiftCellsLeft(store: Store, start: number, count: number): void {
  const cells = store.getCells().map(([key, cell]) => [...parseKey(key), cell] as const);
  cells.filter(([, c]) => c >= start + count).sort((a, b) => a[1] - b[1]).forEach(([r, c, cell]) => {
    store.setCell(r, c, undefined);
    store.setCell(r, c - count, cell);
  });
}

function normalizeCount(count: number | undefined): number {
  return Math.max(1, Math.floor(count ?? 1));
}
