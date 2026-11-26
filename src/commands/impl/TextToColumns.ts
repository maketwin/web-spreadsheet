import { Command } from '../Command';
import { cellFromText } from '../../util/cell';
import { splitColumnValues, type TextToColumnsOptions } from '../../data/textToColumns';
import { withinMaterializationCap } from './effectiveRange';
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
 *
 * The row span clamps to the used range first; past the materialization cap
 * only rows that hold a source cell are split, so a whole-column command
 * never writes a million blank rows.
 */
export class TextToColumnsCommand extends Command<TextToColumnsArgs> {
  private oldCells: Array<{ r: number; c: number; cell: Cell | undefined }> = [];
  private execSheetId: string | undefined;

  public override kind(): 'textToColumns' { return 'textToColumns'; }

  /** Retained payload: one before entry per written cell. */
  public override historyWeight(): number {
    return this.oldCells.length;
  }

  public execute(store: Store): void {
    const { c1, options } = this.args;
    const sid = this.args.sheetId ?? this.execSheetId ?? store.getActiveSheetId();
    this.execSheetId = sid;
    const rows = this.rowsToProcess(store, sid);
    const texts = rows.map((r) => this.sourceText(store, r, c1, sid));
    const matrix = splitColumnValues(texts, options);
    const width = matrix[0]?.length ?? 1;
    this.oldCells = [];
    for (let i = 0; i < rows.length; i += 1) {
      const r = rows[i]!;
      for (let dc = 0; dc < width; dc += 1) {
        const c = c1 + dc;
        this.oldCells.push({ r, c, cell: store.getCell(r, c, sid) });
        const text = matrix[i]?.[dc] ?? '';
        store.setCell(r, c, cellFromText(store.getCell(r, c, sid), text), sid);
      }
    }
  }

  private sourceText(store: Store, r: number, c1: number, sid: string): string {
    const cell = store.getCell(r, c1, sid);
    return cell?.text ?? (cell?.value != null && !(cell.value instanceof Date) ? String(cell.value) : '');
  }

  /** A row span the user could materially write is processed verbatim (the
   * dense walk wrote every row, blanks included). Bigger spans clamp to the
   * used range and, past the cap, split only rows with a stored source cell. */
  private rowsToProcess(store: Store, sid: string): number[] {
    const { r1, c1, r2 } = this.args;
    if (r2 < r1) return []; // the dense walk ran zero iterations for reversed args
    if (withinMaterializationCap({ r1, c1: 0, r2, c2: 0 })) {
      const rows: number[] = [];
      for (let r = r1; r <= r2; r += 1) rows.push(r);
      return rows;
    }
    const bounds = store.getUsedBounds(sid);
    const effHi = bounds !== undefined && bounds.r1 <= r2 && bounds.r2 >= r1 ? Math.min(r2, Math.max(bounds.r2, r1)) : r1;
    if (withinMaterializationCap({ r1, c1: 0, r2: effHi, c2: 0 })) {
      const rows: number[] = [];
      for (let r = r1; r <= effHi; r += 1) rows.push(r);
      return rows;
    }
    const rows: number[] = [];
    store.forEachCellInRect({ r1, c1, r2: effHi, c2: c1 }, (r) => rows.push(r), sid);
    rows.sort((a, b) => a - b);
    if (rows.length === 0) rows.push(r1);
    return rows;
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
