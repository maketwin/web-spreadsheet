import { Command } from '../Command';
import type { Store } from '../../store/Store';
import type { Cell, CellComment } from '../../types';

export interface SetCellCommentArgs {
  readonly r: number;
  readonly c: number;
  /** Pass undefined to remove the comment. */
  readonly comment?: CellComment | undefined;
  readonly sheetId?: string;
}

/** Excel-style cell note: set / replace / remove the comment on one cell.
 * The cell's text and style are untouched. */
export class SetCellCommentCommand extends Command<SetCellCommentArgs> {
  private old: Cell | undefined;
  private execSheetId: string | undefined;

  public execute(store: Store): void {
    const target = this.args.sheetId ?? this.execSheetId ?? store.getActiveSheetId();
    this.execSheetId = target;
    const { r, c, comment } = this.args;
    this.old = store.getCell(r, c, target);
    const base: Cell = this.old !== undefined ? { ...this.old } : { text: '' };
    if (comment === undefined) delete base.comment;
    else base.comment = { ...comment };
    store.setCell(r, c, base, target);
  }

  public getUndo(): Command {
    return new RestoreCommentCell({
      r: this.args.r,
      c: this.args.c,
      cell: this.old,
      ...(this.execSheetId !== undefined ? { sheetId: this.execSheetId } : {}),
    });
  }
}

class RestoreCommentCell extends Command<{ r: number; c: number; cell: Cell | undefined; sheetId?: string }> {
  public execute(store: Store): void {
    const sid = this.args.sheetId ?? store.getActiveSheetId();
    store.setCell(this.args.r, this.args.c, this.args.cell, sid);
  }

  public getUndo(): Command {
    return new SetCellCommentCommand({ r: this.args.r, c: this.args.c, ...(this.args.sheetId !== undefined ? { sheetId: this.args.sheetId } : {}) });
  }
}
