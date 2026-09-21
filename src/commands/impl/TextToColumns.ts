import { Command } from '../Command';
import { cellFromText } from '../../util/cell';
import { splitColumnValues, type TextToColumnsOptions } from '../../data/textToColumns';
import type { Store } from '../../store/Store';
import type { Cell } from '../../types';

export interface TextToColumnsArgs {
  readonly r1: number;
  readonly c1: number;
  readonly r2: number;
  readonly options: TextToColumnsOptions;
  /** Target sheet; defaults to the active sheet at execution time. */
  readonly sheetId?: string;
}

/**
 * Excel 分列 (delimiter): split column c1 into columns starting at c1
 * (overwrites to the right). Undo restores previous cells in the written area.
 */
export class TextToColumnsCommand extends Command<TextToColumnsArgs> {
  private oldCells: Array<{ r: number; c: number; cell: Cell | undefined }> = [];
  private execSheetId: string | undefined;

  public execute(store: Store): void {
    const { r1, c1, r2, options } = this.args;
    const sid = this.args.sheetId ?? this.execSheetId ?? store.getActiveSheetId();
    this.execSheetId = sid;
    const texts: string[] = [];
    for (let r = r1; r <= r2; r += 1) {
      const cell = store.getCell(r, c1, sid);
      texts.push(cell?.text ?? (cell?.value != null && !(cell.value instanceof Date) ? String(cell.value) : ''));
    }
    const matrix = splitColumnValues(texts, options);
    const width = matrix[0]?.length ?? 1;
    this.oldCells = [];
    for (let r = r1; r <= r2; r += 1) {
      for (let dc = 0; dc < width; dc += 1) {
        const c = c1 + dc;
        this.oldCells.push({ r, c, cell: store.getCell(r, c, sid) });
        const text = matrix[r - r1]?.[dc] ?? '';
        store.setCell(r, c, cellFromText(store.getCell(r, c, sid), text), sid);
      }
    }
  }

  public getUndo(): Command {
    return new RestoreCellsCommand({ cells: this.oldCells, ...(this.execSheetId !== undefined ? { sheetId: this.execSheetId } : {}) });
  }
}

interface RestoreCellsArgs {
  readonly cells: Array<{ r: number; c: number; cell: Cell | undefined }>;
  readonly sheetId?: string;
}

class RestoreCellsCommand extends Command<RestoreCellsArgs> {
  public execute(store: Store): void {
    const sid = this.args.sheetId ?? store.getActiveSheetId();
    for (const { r, c, cell } of this.args.cells) store.setCell(r, c, cell, sid);
  }

  public getUndo(): Command {
    return new TextToColumnsCommand({ r1: 0, c1: 0, r2: 0, options: { delimiter: 'comma' }, ...(this.args.sheetId !== undefined ? { sheetId: this.args.sheetId } : {}) });
  }
}
