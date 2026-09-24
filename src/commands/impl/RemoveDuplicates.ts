import { Command } from '../Command';
import { TOTAL_ROWS } from '../../renderer/CanvasRenderer';
import { captureSheet, parseKey, restoreSheet, type SheetSnapshot } from './sheetSnapshot';
import { replaceMerges, shiftMergesForDelete } from '../../util/merge';
import { shiftSheetFormulas } from './shiftFormulas';
import { shiftSheetChartAnchors } from '../../charts/anchorShift';
import { buildRowKeys, findDuplicateRows } from '../../data/removeDuplicates';
import type { Store } from '../../store/Store';

export interface RemoveDuplicatesArgs {
  readonly r1: number;
  readonly c1: number;
  readonly r2: number;
  readonly c2: number;
  /** Column offsets within the range (0 = leftmost). */
  readonly columns: readonly number[];
  readonly hasHeader: boolean;
  /** Target sheet; defaults to the active sheet at execution time. */
  readonly sheetId?: string;
}

/**
 * Excel 删除重复项: delete whole worksheet rows for duplicate keys
 * (first occurrence kept). One undo restores the full sheet snapshot.
 */
export class RemoveDuplicatesCommand extends Command<RemoveDuplicatesArgs> {
  private oldSheet: SheetSnapshot | undefined;
  private removed = 0;
  private execSheetId: string | undefined;

  public execute(store: Store): void {
    const sid = this.args.sheetId ?? this.execSheetId ?? store.getActiveSheetId();
    this.execSheetId = sid;
    this.oldSheet = captureSheet(store, sid);
    const { r1, c1, r2, c2, columns, hasHeader } = this.args;
    if (columns.length === 0 || r2 < r1 || c2 < c1) {
      this.removed = 0;
      return;
    }
    const getText = (r: number, c: number): string => {
      const cell = store.getCell(r, c, sid);
      if (cell?.value !== undefined && cell.value !== null && typeof cell.value !== 'object') {
        return String(cell.value);
      }
      return cell?.text ?? '';
    };
    const keys = buildRowKeys(getText, { r1, c1, r2, c2 }, columns);
    const dupRel = findDuplicateRows(keys, { hasHeader });
    const absRows = dupRel.map((i) => r1 + i).sort((a, b) => b - a);
    this.removed = absRows.length;
    for (const r of absRows) deleteOneRow(store, r, sid);
  }

  public getUndo(): Command {
    return new RestoreSheetCommand(this.oldSheet, this.execSheetId);
  }

  public removedCount(): number {
    return this.removed;
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
    return new RemoveDuplicatesCommand({ r1: 0, c1: 0, r2: 0, c2: 0, columns: [0], hasHeader: false, ...(this.args.sheetId !== undefined ? { sheetId: this.args.sheetId } : {}) });
  }
}

function deleteOneRow(store: Store, start: number, sid: string): void {
  const count = 1;
  store.getCells(sid).forEach(([key]) => {
    const [r, c] = parseKey(key);
    if (r >= start && r < start + count) store.setCell(r, c, undefined, sid);
  });
  shiftCellsUp(store, start, count, sid);
  for (let r = start; r < TOTAL_ROWS; r += 1) store.setRow(r, store.getRow(r + count, sid), sid);
  replaceMerges(store, shiftMergesForDelete(store.getMerges(sid), start, start + count - 1, 'row'), sid);
  shiftSheetFormulas(store, 'row', start, -count, sid);
  shiftSheetChartAnchors(store, 'delete', 'row', start, count, sid);
}

function shiftCellsUp(store: Store, start: number, count: number, sid: string): void {
  const cells = store.getCells(sid).map(([key, cell]) => [...parseKey(key), cell] as const);
  cells.filter(([r]) => r >= start + count).sort((a, b) => a[0] - b[0]).forEach(([r, c, cell]) => {
    store.setCell(r, c, undefined, sid);
    store.setCell(r - count, c, cell, sid);
  });
}
