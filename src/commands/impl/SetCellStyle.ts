import { Command } from '../Command';
import { StyleUsage } from './styleIdentity';

import type { Store } from '../../store/Store';
import type { Cell, Style } from '../../types';

export interface SetCellStyleArgs {
  readonly r: number;
  readonly c: number;
  readonly style: Partial<Style>;
  /** Target sheet; defaults to the active sheet at execution time. */
  readonly sheetId?: string;
}

export class SetCellStyleCommand extends Command<SetCellStyleArgs> {
  private oldCell: Cell | undefined;
  private oldStyle: Style | undefined;
  private execSheetId: string | undefined;
  /** Shared by the commands that restyle a range, so the sheet is swept once for all of them. */
  private readonly usage: StyleUsage | undefined;

  public constructor(args: SetCellStyleArgs, usage?: StyleUsage) {
    super(args);
    this.usage = usage;
  }

  public override kind(): 'setCellStyle' { return 'setCellStyle'; }

  public execute(store: Store): void {
    const target = this.args.sheetId ?? this.execSheetId ?? store.getActiveSheetId();
    this.execSheetId = target;
    const oldCell = store.getCell(this.args.r, this.args.c, target);
    // Undo restores the cell's OWN style entry; the merge base is the style in
    // EFFECT (own > row default > column default), so styling a cell inside a
    // bold column with italic yields bold+italic — Excel semantics.
    const oldOwnStyle = oldCell?.styleId === undefined ? undefined : store.getStyle(oldCell.styleId, target);
    const effective = store.getCellStyle(this.args.r, this.args.c, oldCell, target);
    const nextStyle = { ...effective, ...this.args.style };
    const usage = this.usage ?? StyleUsage.capture(store, target);
    const styleId = usage.forCell(this.args.r, this.args.c, oldCell?.styleId);
    this.oldCell = oldCell;
    this.oldStyle = oldOwnStyle;
    store.setStyle(styleId, nextStyle, target);
    store.setCell(this.args.r, this.args.c, { ...oldCell, text: oldCell?.text ?? '', styleId }, target);
    usage.reassign(oldCell?.styleId, styleId);
  }

  public getUndo(): Command {
    return new RestoreCellStyle({
      r: this.args.r,
      c: this.args.c,
      cell: this.oldCell,
      style: this.oldStyle,
      styleId: this.oldCell?.styleId ?? styleIdFor(this.args.r, this.args.c),
      ...(this.execSheetId !== undefined ? { sheetId: this.execSheetId } : {}),
    });
  }
}

interface RestoreCellStyleArgs {
  readonly r: number;
  readonly c: number;
  readonly cell: Cell | undefined;
  readonly style: Style | undefined;
  readonly styleId: string;
  readonly sheetId?: string;
}

class RestoreCellStyle extends Command<RestoreCellStyleArgs> {
  public execute(store: Store): void {
    const target = this.args.sheetId ?? store.getActiveSheetId();
    store.setCell(this.args.r, this.args.c, this.args.cell, target);
    store.setStyle(this.args.styleId, this.args.style, target);
  }

  public getUndo(): Command {
    return new SetCellStyleCommand({ r: this.args.r, c: this.args.c, style: this.args.style ?? {}, ...(this.args.sheetId !== undefined ? { sheetId: this.args.sheetId } : {}) });
  }
}

export function styleIdFor(r: number, c: number): string {
  return `cell-${r}-${c}`;
}
