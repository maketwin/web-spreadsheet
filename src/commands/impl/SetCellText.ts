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
  readonly richText?: RichTextRun[];
}

export class SetCellText extends Command<SetCellTextArgs> {
  private oldCell: Cell | undefined;

  public execute(store: Store): void {
    const { r, c, text, richText } = this.args;
    const oldCell = store.getCell(r, c);

    this.oldCell = oldCell;
    const next = cellFromText(oldCell, text);
    if (richText !== undefined) next.richText = richText;
    store.setCell(r, c, next);
  }

  public getUndo(): Command {
    return new RestoreCell({ r: this.args.r, c: this.args.c, cell: this.oldCell });
  }
}

interface RestoreCellArgs {
  readonly r: number;
  readonly c: number;
  readonly cell: Cell | undefined;
}

class RestoreCell extends Command<RestoreCellArgs> {
  public execute(store: Store): void {
    store.setCell(this.args.r, this.args.c, this.args.cell);
  }

  public getUndo(): Command {
    return new RestoreCell({ r: this.args.r, c: this.args.c, cell: this.args.cell });
  }
}
