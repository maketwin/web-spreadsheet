import { Command } from '../Command';
import { TOTAL_ROWS } from '../../renderer/CanvasRenderer';
import { captureSheet, parseKey, restoreSheet, type SheetSnapshot } from './sheetSnapshot';
import { replaceMerges, shiftMergesForDelete } from '../../util/merge';
import { shiftSheetFormulas } from './shiftFormulas';
import { shiftSheetChartAnchors } from '../../charts/anchorShift';

import type { Store } from '../../store/Store';

export interface DeleteRowArgs {
  readonly r: number;
  readonly count?: number;
  /** Target sheet; defaults to the active sheet at execution time. */
  readonly sheetId?: string;
}

export class DeleteRowCommand extends Command<DeleteRowArgs> {
  private oldSheet: SheetSnapshot | undefined;
  private execSheetId: string | undefined;

  public execute(store: Store): void {
    const target = this.args.sheetId ?? this.execSheetId ?? store.getActiveSheetId();
    this.execSheetId = target;
    this.oldSheet = captureSheet(store, target);
    const count = normalizeCount(this.args.count);
    const start = this.args.r;
    store.getCells(target).forEach(([key]) => {
      const [r, c] = parseKey(key);
      if (r >= start && r < start + count) store.setCell(r, c, undefined, target);
    });
    shiftCellsUp(store, start, count, target);
    for (let r = start; r < TOTAL_ROWS; r += 1) store.setRow(r, store.getRow(r + count, target), target);
    replaceMerges(store, shiftMergesForDelete(store.getMerges(target), start, start + count - 1, 'row'), target);
    shiftSheetFormulas(store, 'row', start, -count, target);
    shiftSheetChartAnchors(store, 'delete', 'row', start, count, target);
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
    return new DeleteRowCommand({ r: 0, ...(this.args.sheetId !== undefined ? { sheetId: this.args.sheetId } : {}) });
  }
}

function shiftCellsUp(store: Store, start: number, count: number, target: string): void {
  const cells = store.getCells(target).map(([key, cell]) => [...parseKey(key), cell] as const);
  cells.filter(([r]) => r >= start + count).sort((a, b) => a[0] - b[0]).forEach(([r, c, cell]) => {
    store.setCell(r, c, undefined, target);
    store.setCell(r - count, c, cell, target);
  });
}

function normalizeCount(count: number | undefined): number {
  return Math.max(1, Math.floor(count ?? 1));
}
