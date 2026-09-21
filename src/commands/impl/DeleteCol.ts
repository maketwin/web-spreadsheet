import { Command } from '../Command';
import { TOTAL_COLS } from '../../renderer/CanvasRenderer';
import { captureSheet, parseKey, restoreSheet, type SheetSnapshot } from './sheetSnapshot';
import { replaceMerges, shiftMergesForDelete } from '../../util/merge';
import { shiftSheetFormulas } from './shiftFormulas';
import { shiftSheetChartAnchors } from '../../charts/anchorShift';

import type { Store } from '../../store/Store';

export interface DeleteColArgs {
  readonly c: number;
  readonly count?: number;
  /** Target sheet; defaults to the active sheet at execution time. */
  readonly sheetId?: string;
}

export class DeleteColCommand extends Command<DeleteColArgs> {
  private oldSheet: SheetSnapshot | undefined;
  private execSheetId: string | undefined;

  public execute(store: Store): void {
    const target = this.args.sheetId ?? this.execSheetId ?? store.getActiveSheetId();
    this.execSheetId = target;
    this.oldSheet = captureSheet(store, target);
    const count = normalizeCount(this.args.count);
    const start = this.args.c;
    store.getCells(target).forEach(([key]) => {
      const [r, c] = parseKey(key);
      if (c >= start && c < start + count) store.setCell(r, c, undefined, target);
    });
    shiftCellsLeft(store, start, count, target);
    for (let c = start; c < TOTAL_COLS; c += 1) store.setCol(c, store.getCol(c + count, target), target);
    replaceMerges(store, shiftMergesForDelete(store.getMerges(target), start, start + count - 1, 'col'), target);
    shiftSheetFormulas(store, 'col', start, -count, target);
    shiftSheetChartAnchors(store, 'delete', 'col', start, count);
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
    return new DeleteColCommand({ c: 0, ...(this.args.sheetId !== undefined ? { sheetId: this.args.sheetId } : {}) });
  }
}

function shiftCellsLeft(store: Store, start: number, count: number, target: string): void {
  const cells = store.getCells(target).map(([key, cell]) => [...parseKey(key), cell] as const);
  cells.filter(([, c]) => c >= start + count).sort((a, b) => a[1] - b[1]).forEach(([r, c, cell]) => {
    store.setCell(r, c, undefined, target);
    store.setCell(r, c - count, cell, target);
  });
}

function normalizeCount(count: number | undefined): number {
  return Math.max(1, Math.floor(count ?? 1));
}
