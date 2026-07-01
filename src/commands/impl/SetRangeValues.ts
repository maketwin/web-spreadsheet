import { Command } from '../Command';

import type { Store } from '../../store/Store';
import type { Cell } from '../../types';

export interface SetRangeValuesArgs {
  readonly r1: number;
  readonly c1: number;
  readonly r2: number;
  readonly c2: number;
  readonly values: readonly (readonly (Partial<Cell> | undefined)[])[];
}

export class SetRangeValues extends Command<SetRangeValuesArgs> {
  private oldValues: CellMatrix = [];

  public execute(store: Store): void {
    const { r1, c1, r2, c2, values } = this.args;
    this.oldValues = [];

    for (let r = r1; r <= r2; r += 1) {
      const row: Array<Cell | undefined> = [];
      const valueRow = values[r - r1];

      for (let c = c1; c <= c2; c += 1) {
        const oldCell = store.getCell(r, c);
        const newValue = valueRow?.[c - c1];
        row.push(oldCell);

        if (newValue !== undefined) {
          const text = newValue.text ?? oldCell?.text ?? '';
          store.setCell(r, c, { ...oldCell, ...newValue, text });
        }
      }
      this.oldValues.push(row);
    }
  }

  public getUndo(): Command {
    return new RestoreRangeValues({
      r1: this.args.r1,
      c1: this.args.c1,
      values: this.oldValues,
    });
  }
}

type CellMatrix = Array<Array<Cell | undefined>>;

interface RestoreRangeValuesArgs {
  readonly r1: number;
  readonly c1: number;
  readonly values: CellMatrix;
}

class RestoreRangeValues extends Command<RestoreRangeValuesArgs> {
  public execute(store: Store): void {
    this.args.values.forEach((row, rowIndex) => {
      row.forEach((cell, colIndex) => {
        store.setCell(this.args.r1 + rowIndex, this.args.c1 + colIndex, cell);
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
