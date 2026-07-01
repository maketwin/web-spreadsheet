import { Command } from '../Command';
import type { Store } from '../../store/Store';
import type { RangeAddress } from '../../selection/Range';
import type { Cell, Style } from '../../types';

export interface SetNumberFormatArgs extends RangeAddress {
  readonly numberFormat: NonNullable<Style['numberFormat']>;
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

  public execute(store: Store): void {
    const snaps: CellSnapshot[] = [];
    for (let r = this.args.r1; r <= this.args.r2; r += 1) {
      for (let c = this.args.c1; c <= this.args.c2; c += 1) {
        snaps.push(snapshot(store, r, c));
        applyFormat(store, r, c, this.args.numberFormat);
      }
    }
    this.oldSnapshots = snaps;
  }

  public getUndo(): Command {
    return new RestoreNumberFormat(this.oldSnapshots);
  }
}

class RestoreNumberFormat extends Command<readonly CellSnapshot[]> {
  public execute(store: Store): void {
    this.args.forEach((snap) => {
      store.setCell(snap.r, snap.c, snap.cell);
      if (snap.styleId !== undefined) store.setStyle(snap.styleId, snap.style);
    });
  }

  public getUndo(): Command {
    const first = this.args[0];
    return new SetNumberFormatCommand({ r1: first?.r ?? 0, c1: first?.c ?? 0, r2: first?.r ?? 0, c2: first?.c ?? 0, numberFormat: 'general' });
  }
}

function snapshot(store: Store, r: number, c: number): CellSnapshot {
  const cell = store.getCell(r, c);
  const styleId = cell?.styleId;
  const style = styleId === undefined ? undefined : store.getStyle(styleId);
  return { r, c, cell, style, styleId };
}

function applyFormat(store: Store, r: number, c: number, numberFormat: NonNullable<Style['numberFormat']>): void {
  let cell = store.getCell(r, c);
  if (cell === undefined) cell = { text: '' };
  const styleId = cell.styleId ?? `nf-${r}-${c}`;
  const existing = store.getStyle(styleId);
  store.setStyle(styleId, { ...existing, numberFormat });
  store.setCell(r, c, { ...cell, styleId });
}
