import { Command } from '../Command';
import type { Store } from '../../store/Store';
import type { Cell, CellHyperlink } from '../../types';

export interface SetHyperlinkArgs {
  readonly r: number;
  readonly c: number;
  /** Pass undefined / omit target clear to remove the hyperlink. */
  readonly hyperlink?: CellHyperlink | undefined;
  /** Optional display text written with the link. */
  readonly displayText?: string;
  readonly sheetId?: string;
}

export class SetHyperlinkCommand extends Command<SetHyperlinkArgs> {
  private old: Cell | undefined;
  private execSheetId: string | undefined;

  public execute(store: Store): void {
    const target = this.args.sheetId ?? this.execSheetId ?? store.getActiveSheetId();
    this.execSheetId = target;
    const { r, c, hyperlink, displayText } = this.args;
    this.old = store.getCell(r, c, target);
    const base: Cell = this.old !== undefined ? { ...this.old } : { text: '' };
    if (hyperlink === undefined) delete base.hyperlink;
    else base.hyperlink = { ...hyperlink };
    if (displayText !== undefined) base.text = displayText;
    else if ((base.text === undefined || base.text === '') && hyperlink !== undefined) base.text = hyperlink.target;
    store.setCell(r, c, base, target);
  }

  public getUndo(): Command {
    return new RestoreHyperlinkCell({
      r: this.args.r,
      c: this.args.c,
      cell: this.old,
      ...(this.execSheetId !== undefined ? { sheetId: this.execSheetId } : {}),
    });
  }
}

class RestoreHyperlinkCell extends Command<{ r: number; c: number; cell: Cell | undefined; sheetId?: string }> {
  public execute(store: Store): void {
    const sid = this.args.sheetId ?? store.getActiveSheetId();
    store.setCell(this.args.r, this.args.c, this.args.cell, sid);
  }

  public getUndo(): Command {
    return new SetHyperlinkCommand({ r: this.args.r, c: this.args.c });
  }
}
