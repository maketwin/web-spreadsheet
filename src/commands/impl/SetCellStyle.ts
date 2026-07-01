import { Command } from '../Command';

import type { Store } from '../../store/Store';
import type { Cell, Style } from '../../types';

export interface SetCellStyleArgs {
  readonly r: number;
  readonly c: number;
  readonly style: Partial<Style>;
}

export class SetCellStyleCommand extends Command<SetCellStyleArgs> {
  private oldCell: Cell | undefined;
  private oldStyle: Style | undefined;

  public execute(store: Store): void {
    const oldCell = store.getCell(this.args.r, this.args.c);
    const oldStyle = oldCell?.styleId === undefined ? undefined : store.getStyle(oldCell.styleId);
    const nextStyle = { ...oldStyle, ...this.args.style };
    const styleId = oldCell?.styleId ?? styleIdFor(this.args.r, this.args.c);
    this.oldCell = oldCell;
    this.oldStyle = oldStyle;
    store.setStyle(styleId, nextStyle);
    store.setCell(this.args.r, this.args.c, { ...oldCell, text: oldCell?.text ?? '', styleId });
  }

  public getUndo(): Command {
    return new RestoreCellStyle({
      r: this.args.r,
      c: this.args.c,
      cell: this.oldCell,
      style: this.oldStyle,
      styleId: this.oldCell?.styleId ?? styleIdFor(this.args.r, this.args.c),
    });
  }
}

interface RestoreCellStyleArgs {
  readonly r: number;
  readonly c: number;
  readonly cell: Cell | undefined;
  readonly style: Style | undefined;
  readonly styleId: string;
}

class RestoreCellStyle extends Command<RestoreCellStyleArgs> {
  public execute(store: Store): void {
    store.setCell(this.args.r, this.args.c, this.args.cell);
    store.setStyle(this.args.styleId, this.args.style);
  }

  public getUndo(): Command {
    return new SetCellStyleCommand({ r: this.args.r, c: this.args.c, style: this.args.style ?? {} });
  }
}

export function styleIdFor(r: number, c: number): string {
  return `cell-${r}-${c}`;
}
