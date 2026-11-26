import { Command } from '../Command';
import { SetCellStyleCommand } from './SetCellStyle';
import { SetAxisStyleCommand, axisSelectionOf } from './SetAxisStyle';
import { StyleUsage } from './styleIdentity';
import { effectiveRange, withinMaterializationCap } from './effectiveRange';

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
  /** Set when the selection turned out to be a whole-axis format write. */
  private axisCommand: SetAxisStyleCommand | undefined;

  public override kind(): 'setRangeStyle' { return 'setRangeStyle'; }

  public execute(store: Store): void {
    this.oldCells = [];
    this.axisCommand = undefined;
    const target = this.args.sheetId ?? this.execSheetId ?? store.getActiveSheetId();
    this.execSheetId = target;
    // Excel: a whole-column / whole-row / whole-sheet selection formats the
    // axis itself (O(selection width), one meta per column/row) instead of
    // materializing cells — the format also shows on blank and future cells.
    const axis = axisSelectionOf(this.args);
    if (axis !== null) {
      const axisCmd = new SetAxisStyleCommand({ axis: axis.axis, from: axis.from, to: axis.to, style: this.args.style, sheetId: target });
      axisCmd.execute.bind(axisCmd)(store);
      this.axisCommand = axisCmd;
      return;
    }
    // Bounded selections walk only the used part of the sheet past the
    // materialization cap; blank cells are not created there.
    const eff = effectiveRange(store, this.args, target);
    const usage = StyleUsage.capture(store, target);
    const each = (r: number, c: number): void => {
      this.capture(store, r, c, target);
      const apply = new SetCellStyleCommand({ r, c, style: this.args.style, sheetId: target }, usage);
      apply.execute.bind(apply)(store);
    };
    if (withinMaterializationCap(eff)) {
      for (let r = eff.r1; r <= eff.r2; r += 1) {
        for (let c = eff.c1; c <= eff.c2; c += 1) each(r, c);
      }
    } else {
      store.forEachCellInRect(eff, (r, c) => each(r, c), target);
    }
  }

  public getUndo(): Command {
    if (this.axisCommand !== undefined) return this.axisCommand.getUndo();
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
