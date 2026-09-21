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
}

/**
 * Excel 分列 (delimiter): split column c1 into columns starting at c1
 * (overwrites to the right). Undo restores previous cells in the written area.
 */
export class TextToColumnsCommand extends Command<TextToColumnsArgs> {
  private oldCells: Array<{ r: number; c: number; cell: Cell | undefined }> = [];

  public execute(store: Store): void {
    const { r1, c1, r2, options } = this.args;
    const texts: string[] = [];
    for (let r = r1; r <= r2; r += 1) {
      const cell = store.getCell(r, c1);
      texts.push(cell?.text ?? (cell?.value != null && !(cell.value instanceof Date) ? String(cell.value) : ''));
    }
    const matrix = splitColumnValues(texts, options);
    const width = matrix[0]?.length ?? 1;
    this.oldCells = [];
    for (let r = r1; r <= r2; r += 1) {
      for (let dc = 0; dc < width; dc += 1) {
        const c = c1 + dc;
        this.oldCells.push({ r, c, cell: store.getCell(r, c) });
        const text = matrix[r - r1]?.[dc] ?? '';
        store.setCell(r, c, cellFromText(store.getCell(r, c), text));
      }
    }
  }

  public getUndo(): Command {
    return new RestoreCellsCommand(this.oldCells);
  }
}

class RestoreCellsCommand extends Command<Array<{ r: number; c: number; cell: Cell | undefined }>> {
  public execute(store: Store): void {
    for (const { r, c, cell } of this.args) store.setCell(r, c, cell);
  }

  public getUndo(): Command {
    return new TextToColumnsCommand({ r1: 0, c1: 0, r2: 0, options: { delimiter: 'comma' } });
  }
}
