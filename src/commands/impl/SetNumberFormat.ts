import { Command } from '../Command';
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

  public execute(store: Store): void {
    const sid = this.args.sheetId ?? this.execSheetId ?? store.getActiveSheetId();
    this.execSheetId = sid;
    const snaps: CellSnapshot[] = [];
    for (let r = this.args.r1; r <= this.args.r2; r += 1) {
      for (let c = this.args.c1; c <= this.args.c2; c += 1) {
        snaps.push(snapshot(store, r, c, sid));
        applyFormat(store, r, c, this.args.numberFormat, sid);
      }
    }
    this.oldSnapshots = snaps;
  }

  public getUndo(): Command {
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

function applyFormat(store: Store, r: number, c: number, numberFormat: NonNullable<Style['numberFormat']>, sheetId: string): void {
  let cell = store.getCell(r, c, sheetId);
  if (cell === undefined) cell = { text: '' };
  const styleId = cell.styleId ?? `nf-${r}-${c}`;
  const existing = store.getStyle(styleId, sheetId);
  store.setStyle(styleId, { ...existing, numberFormat }, sheetId);
  store.setCell(r, c, { ...cell, styleId }, sheetId);
}
