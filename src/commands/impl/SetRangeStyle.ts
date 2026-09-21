import { Command } from '../Command';
import { SetCellStyleCommand } from './SetCellStyle';

import type { Store } from '../../store/Store';
import type { RangeAddress } from '../../selection/Range';
import type { Cell, Style } from '../../types';

export interface SetRangeStyleArgs extends RangeAddress {
  readonly style: Partial<Style>;
  /** Target sheet; defaults to the active sheet at execution time. */
  readonly sheetId?: string;
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
  private execSheetId: string | undefined;

  public execute(store: Store): void {
    this.oldCells = [];
    const target = this.args.sheetId ?? this.execSheetId ?? store.getActiveSheetId();
    this.execSheetId = target;
    for (let r = this.args.r1; r <= this.args.r2; r += 1) {
      for (let c = this.args.c1; c <= this.args.c2; c += 1) {
        this.capture(store, r, c, target);
        new SetCellStyleCommand({ r, c, style: this.args.style, sheetId: target }).execute(store);
      }
    }
  }

  public getUndo(): Command {
    return new RestoreRangeStyle({ snapshots: this.oldCells, ...(this.execSheetId !== undefined ? { sheetId: this.execSheetId } : {}) });
  }

  private capture(store: Store, r: number, c: number, target: string): void {
    const cell = store.getCell(r, c, target);
    const style = cell?.styleId === undefined ? undefined : store.getStyle(cell.styleId, target);
    this.oldCells.push({ r, c, cell, style, styleId: cell?.styleId });
  }
}

interface RestoreRangeStyleArgs {
  readonly snapshots: readonly CellStyleSnapshot[];
  readonly sheetId?: string;
}

class RestoreRangeStyle extends Command<RestoreRangeStyleArgs> {
  public execute(store: Store): void {
    const target = this.args.sheetId ?? store.getActiveSheetId();
    this.args.snapshots.forEach((item) => {
      store.setCell(item.r, item.c, item.cell, target);
      if (item.styleId !== undefined) store.setStyle(item.styleId, item.style, target);
    });
  }

  public getUndo(): Command {
    const first = this.args.snapshots[0];
    return new SetCellStyleCommand({ r: first?.r ?? 0, c: first?.c ?? 0, style: {}, ...(this.args.sheetId !== undefined ? { sheetId: this.args.sheetId } : {}) });
  }
}
