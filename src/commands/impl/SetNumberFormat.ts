import { Command } from '../Command';
import { SetAxisStyleCommand, axisSelectionOf } from './SetAxisStyle';
import { StyleUsage } from './styleIdentity';
import { effectiveRange, withinMaterializationCap } from './effectiveRange';
import type { Store } from '../../store/Store';
import type { RangeAddress } from '../../selection/Range';
import type { Cell, Style } from '../../types';

export interface SetNumberFormatArgs extends RangeAddress {
  readonly numberFormat: NonNullable<Style['numberFormat']>;
  /** Target sheet; defaults to the active sheet at execution time. */
  readonly sheetId?: string;
}

interface CellSnapshot {
  readonly r: number;
  readonly c: number;
  readonly cell: Cell | undefined;
  readonly style: Style | undefined;
  readonly styleId: string | undefined;
}

export class SetNumberFormatCommand extends Command<SetNumberFormatArgs> {
  private oldSnapshots: readonly CellSnapshot[] = [];
  private execSheetId: string | undefined;
  /** Set when the selection turned out to be a whole-axis format write. */
  private axisCommand: SetAxisStyleCommand | undefined;

  public override kind(): 'setNumberFormat' { return 'setNumberFormat'; }

  public execute(store: Store): void {
    const sid = this.args.sheetId ?? this.execSheetId ?? store.getActiveSheetId();
    this.execSheetId = sid;
    // Excel: a whole-column / whole-row selection writes the axis default
    // format — one meta per column/row, no cells materialized (whole sheet =
    // column defaults for all 16,384 columns; see axisSelectionOf).
    const axis = axisSelectionOf(this.args);
    if (axis !== null) {
      const axisCmd = new SetAxisStyleCommand({ axis: axis.axis, from: axis.from, to: axis.to, style: { numberFormat: this.args.numberFormat }, sheetId: sid });
      axisCmd.execute.bind(axisCmd)(store);
      this.axisCommand = axisCmd;
      this.oldSnapshots = [];
      return;
    }
    const snaps: CellSnapshot[] = [];
    const usage = StyleUsage.capture(store, sid);
    const each = (r: number, c: number): void => {
      snaps.push(snapshot(store, r, c, sid));
      applyFormat(store, r, c, this.args.numberFormat, sid, usage);
    };
    const eff = effectiveRange(store, this.args, sid);
    if (withinMaterializationCap(eff)) {
      for (let r = eff.r1; r <= eff.r2; r += 1) {
        for (let c = eff.c1; c <= eff.c2; c += 1) each(r, c);
      }
    } else {
      // Past the cap only cells that exist are touched; blanks are not created.
      store.forEachCellInRect(eff, (r, c) => each(r, c), sid);
    }
    this.oldSnapshots = snaps;
  }

  public getUndo(): Command {
    if (this.axisCommand !== undefined) return this.axisCommand.getUndo();
    return new RestoreNumberFormat({ snapshots: this.oldSnapshots, ...(this.execSheetId !== undefined ? { sheetId: this.execSheetId } : {}) });
  }
}

interface RestoreNumberFormatArgs {
  readonly snapshots: readonly CellSnapshot[];
  readonly sheetId?: string;
}

class RestoreNumberFormat extends Command<RestoreNumberFormatArgs> {
  public execute(store: Store): void {
    const sid = this.args.sheetId ?? store.getActiveSheetId();
    this.args.snapshots.forEach((snap) => {
      store.setCell(snap.r, snap.c, snap.cell, sid);
      if (snap.styleId !== undefined) store.setStyle(snap.styleId, snap.style, sid);
    });
  }

  public getUndo(): Command {
    const first = this.args.snapshots[0];
    return new SetNumberFormatCommand({ r1: first?.r ?? 0, c1: first?.c ?? 0, r2: first?.r ?? 0, c2: first?.c ?? 0, numberFormat: 'general', ...(this.args.sheetId !== undefined ? { sheetId: this.args.sheetId } : {}) });
  }
}

function snapshot(store: Store, r: number, c: number, sheetId: string): CellSnapshot {
  const cell = store.getCell(r, c, sheetId);
  const styleId = cell?.styleId;
  const style = styleId === undefined ? undefined : store.getStyle(styleId, sheetId);
  return { r, c, cell, style, styleId };
}

function applyFormat(store: Store, r: number, c: number, numberFormat: NonNullable<Style['numberFormat']>, sheetId: string, usage: StyleUsage): void {
  let cell = store.getCell(r, c, sheetId);
  if (cell === undefined) cell = { text: '' };
  const styleId = usage.forCell(r, c, cell.styleId);
  // The merge base is the style in effect (own > row default > column
  // default): formatting one cell of a percent column keeps the percent
  // format unless the new one replaces it.
  const existing = store.getCellStyle(r, c, cell, sheetId);
  store.setStyle(styleId, { ...existing, numberFormat }, sheetId);
  store.setCell(r, c, { ...cell, styleId }, sheetId);
  usage.reassign(cell.styleId, styleId);
}
