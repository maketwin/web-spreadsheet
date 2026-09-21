import { Command } from '../Command';
import { cellFromText } from '../../util/cell';

import type { Store } from '../../store/Store';
import type { Cell, RichTextRun } from '../../types';

export interface SetCellTextArgs {
  readonly r: number;
  readonly c: number;
  readonly text: string;
  /** Rich runs for a text-constant cell; `text` must equal their concatenation.
   * Omitted (the default everywhere except the rich editor commit) flattens the cell. */
  readonly richText?: RichTextRun[] | undefined;
  /** Target sheet; defaults to the active sheet at execution time. */
  readonly sheetId?: string;
}

export class SetCellText extends Command<SetCellTextArgs> {
  private oldCell: Cell | undefined;
  /** Sheet the last execute() ran against — undo/redo re-target it even after a switch. */
  private execSheetId: string | undefined;

  public execute(store: Store): void {
    const { r, c, text, richText } = this.args;
    const target = this.args.sheetId ?? this.execSheetId ?? store.getActiveSheetId();
    this.execSheetId = target;
    const oldCell = store.getCell(r, c, target);

    this.oldCell = oldCell;
    const next = cellFromText(oldCell, text);
    if (richText !== undefined) next.richText = richText;
    store.setCell(r, c, next, target);
  }

  public getUndo(): Command {
    return new RestoreCell({ r: this.args.r, c: this.args.c, cell: this.oldCell, ...(this.execSheetId !== undefined ? { sheetId: this.execSheetId } : {}) });
  }
}

interface RestoreCellArgs {
  readonly r: number;
  readonly c: number;
  readonly cell: Cell | undefined;
  readonly sheetId?: string;
}

class RestoreCell extends Command<RestoreCellArgs> {
  public execute(store: Store): void {
    const target = this.args.sheetId ?? store.getActiveSheetId();
    store.setCell(this.args.r, this.args.c, this.args.cell, target);
  }

  public getUndo(): Command {
    return this;
  }
}
