import { Command } from '../Command';

import type { Store } from '../../store/Store';
import type { Cell } from '../../types';

export interface SetCellTextArgs {
  readonly r: number;
  readonly c: number;
  readonly text: string;
}

export class SetCellText extends Command<SetCellTextArgs> {
  private oldCell: Cell | undefined;

  public execute(store: Store): void {
    const { r, c, text } = this.args;
    const oldCell = store.getCell(r, c);

    this.oldCell = oldCell;
    store.setCell(r, c, { ...oldCell, text });
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
    const currentText = this.args.cell?.text ?? '';
    return new SetCellText({ r: this.args.r, c: this.args.c, text: currentText });
  }
}
