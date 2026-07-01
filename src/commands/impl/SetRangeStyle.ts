import { Command } from '../Command';
import { SetCellStyleCommand } from './SetCellStyle';

import type { Store } from '../../store/Store';
import type { RangeAddress } from '../../selection/Range';
import type { Cell, Style } from '../../types';

export interface SetRangeStyleArgs extends RangeAddress {
  readonly style: Partial<Style>;
}

interface CellStyleSnapshot {
  readonly r: number;
  readonly c: number;
  readonly cell: Cell | undefined;
  readonly style: Style | undefined;
  readonly styleId: string | undefined;
}

export class SetRangeStyleCommand extends Command<SetRangeStyleArgs> {
  private oldCells: CellStyleSnapshot[] = [];

  public execute(store: Store): void {
    this.oldCells = [];
    for (let r = this.args.r1; r <= this.args.r2; r += 1) {
      for (let c = this.args.c1; c <= this.args.c2; c += 1) {
        this.capture(store, r, c);
        new SetCellStyleCommand({ r, c, style: this.args.style }).execute(store);
      }
    }
  }

  public getUndo(): Command {
    return new RestoreRangeStyle(this.oldCells);
  }

  private capture(store: Store, r: number, c: number): void {
    const cell = store.getCell(r, c);
    const style = cell?.styleId === undefined ? undefined : store.getStyle(cell.styleId);
    this.oldCells.push({ r, c, cell, style, styleId: cell?.styleId });
  }
}

class RestoreRangeStyle extends Command<readonly CellStyleSnapshot[]> {
  public execute(store: Store): void {
    this.args.forEach((item) => {
      store.setCell(item.r, item.c, item.cell);
      if (item.styleId !== undefined) store.setStyle(item.styleId, item.style);
    });
  }

  public getUndo(): Command {
    const first = this.args[0];
    return new SetCellStyleCommand({ r: first?.r ?? 0, c: first?.c ?? 0, style: {} });
  }
}
