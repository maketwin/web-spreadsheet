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
}

/**
 * Excel 删除重复项: delete whole worksheet rows for duplicate keys
 * (first occurrence kept). One undo restores the full sheet snapshot.
 */
export class RemoveDuplicatesCommand extends Command<RemoveDuplicatesArgs> {
  private oldSheet: SheetSnapshot | undefined;
  private removed = 0;

  public execute(store: Store): void {
    this.oldSheet = captureSheet(store);
    const { r1, c1, r2, c2, columns, hasHeader } = this.args;
    if (columns.length === 0 || r2 < r1 || c2 < c1) {
      this.removed = 0;
      return;
    }
    const getText = (r: number, c: number): string => {
      const cell = store.getCell(r, c);
      if (cell?.value !== undefined && cell.value !== null && typeof cell.value !== 'object') {
        return String(cell.value);
      }
      return cell?.text ?? '';
    };
    const keys = buildRowKeys(getText, { r1, c1, r2, c2 }, columns);
    const dupRel = findDuplicateRows(keys, { hasHeader });
    const absRows = dupRel.map((i) => r1 + i).sort((a, b) => b - a);
    this.removed = absRows.length;
    for (const r of absRows) deleteOneRow(store, r);
  }

  public getUndo(): Command {
    return new RestoreSheetCommand(this.oldSheet);
  }

  public removedCount(): number {
    return this.removed;
  }
}

class RestoreSheetCommand extends Command<SheetSnapshot | undefined> {
  public execute(store: Store): void {
    if (this.args !== undefined) restoreSheet(store, this.args);
  }

  public getUndo(): Command {
    return new RemoveDuplicatesCommand({ r1: 0, c1: 0, r2: 0, c2: 0, columns: [0], hasHeader: false });
  }
}

function deleteOneRow(store: Store, start: number): void {
  const count = 1;
  store.getCells().forEach(([key]) => {
    const [r, c] = parseKey(key);
    if (r >= start && r < start + count) store.setCell(r, c, undefined);
  });
  shiftCellsUp(store, start, count);
  for (let r = start; r < TOTAL_ROWS; r += 1) store.setRow(r, store.getRow(r + count));
  replaceMerges(store, shiftMergesForDelete(store.getMerges(), start, start + count - 1, 'row'));
  shiftSheetFormulas(store, 'row', start, -count);
  shiftSheetChartAnchors(store, 'delete', 'row', start, count);
}

function shiftCellsUp(store: Store, start: number, count: number): void {
  const cells = store.getCells().map(([key, cell]) => [...parseKey(key), cell] as const);
  cells.filter(([r]) => r >= start + count).sort((a, b) => a[0] - b[0]).forEach(([r, c, cell]) => {
    store.setCell(r, c, undefined);
    store.setCell(r - count, c, cell);
  });
}
