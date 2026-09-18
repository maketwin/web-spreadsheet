import { Command } from '../Command';
import { cellFromText } from '../../util/cell';

import type { Store } from '../../store/Store';
import type { Cell } from '../../types';

/** Like Partial<Cell> but allows explicit `undefined` (full cell replacement, e.g. paste). */
export type CellPatch = { readonly [K in keyof Cell]?: Cell[K] | undefined };

export interface SetRangeValuesArgs {
  readonly r1: number;
  readonly c1: number;
  readonly r2: number;
  readonly c2: number;
  readonly values: readonly (readonly (CellPatch | undefined)[])[];
  /** Target sheet; defaults to the active sheet (all pre-existing callers). */
  readonly sheetId?: string;
}

export class SetRangeValues extends Command<SetRangeValuesArgs> {
  private oldValues: CellMatrix = [];
  /** Sheet the last execute() ran against: the explicit arg, else the active sheet at execution time —
   * so undo/redo restore to the right sheet even if the user has switched since. */
  private execSheetId: string | undefined;

  public execute(store: Store): void {
    const { r1, c1, r2, c2, values, sheetId } = this.args;
    // First run without an explicit sheetId targets the active sheet and
    // records it; a redo (re-run) reuses that sheet even if the user has
    // switched since.
    const target = sheetId ?? this.execSheetId ?? store.getActiveSheetId();
    this.execSheetId = target;
    this.oldValues = [];

    for (let r = r1; r <= r2; r += 1) {
      const row: Array<Cell | undefined> = [];
      const valueRow = values[r - r1];

      for (let c = c1; c <= c2; c += 1) {
        const oldCell = store.getCell(r, c, target);
        const newValue = valueRow?.[c - c1];
        row.push(oldCell);

        if (newValue !== undefined) store.setCell(r, c, nextCell(oldCell, newValue), target);
      }
      this.oldValues.push(row);
    }
  }

  public getUndo(): Command {
    return new RestoreRangeValues({
      r1: this.args.r1,
      c1: this.args.c1,
      values: this.oldValues,
      ...(this.execSheetId !== undefined ? { sheetId: this.execSheetId } : {}),
    });
  }
}

function nextCell(oldCell: Cell | undefined, newValue: CellPatch): Cell {
  const text = newValue.text ?? oldCell?.text ?? '';
  // Strip explicit-undefined keys so the merged result stays a valid Cell
  // under exactOptionalPropertyTypes (undefined keys mean "clear the field").
  const patch: Partial<Cell> = {};
  (Object.keys(newValue) as (keyof Cell)[]).forEach((key) => {
    const v = newValue[key];
    if (v === undefined) return;
    (patch as Record<string, unknown>)[key] = v;
  });
  const clears = (key: keyof Cell): boolean => key in newValue && newValue[key] === undefined;
  const setRichText = (base: Cell): void => {
    // Rich runs ride only with an explicit patch (paste of a copied rich cell)
    // or an untouched text; a text rewrite without runs flattens the cell.
    if ('richText' in newValue) {
      if (newValue.richText === undefined) delete base.richText;
      else base.richText = newValue.richText;
    } else if (newValue.text !== undefined && newValue.text !== oldCell?.text) {
      delete base.richText;
    }
  };
  if (newValue.text !== undefined && newValue.formula === undefined && newValue.value === undefined) {
    const base: Cell = { ...oldCell, ...patch, text };
    if (clears('formula')) delete base.formula;
    if (clears('value')) delete base.value;
    if (clears('styleId')) delete base.styleId;
    if (clears('type')) delete base.type;
    const next = cellFromText(base, text);
    setRichText(next);
    return next;
  }
  const merged: Cell = { ...oldCell, ...patch, text };
  if (clears('formula')) delete merged.formula;
  if (clears('value')) delete merged.value;
  if (clears('styleId')) delete merged.styleId;
  if (clears('type')) delete merged.type;
  setRichText(merged);
  return merged;
}

type CellMatrix = Array<Array<Cell | undefined>>;

interface RestoreRangeValuesArgs {
  readonly r1: number;
  readonly c1: number;
  readonly values: CellMatrix;
  readonly sheetId?: string;
}

class RestoreRangeValues extends Command<RestoreRangeValuesArgs> {
  public execute(store: Store): void {
    this.args.values.forEach((row, rowIndex) => {
      row.forEach((cell, colIndex) => {
        store.setCell(this.args.r1 + rowIndex, this.args.c1 + colIndex, cell, this.args.sheetId);
      });
    });
  }

  public getUndo(): Command {
    const r2 = this.args.r1 + this.args.values.length - 1;
    const firstRow = this.args.values[0];
    const c2 = this.args.c1 + (firstRow?.length ?? 1) - 1;

    return new SetRangeValues({
      r1: this.args.r1,
      c1: this.args.c1,
      r2,
      c2,
      values: this.args.values,
    });
  }
}
