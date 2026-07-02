import { Command } from '../Command';
import type { Store } from '../../store/Store';
import type { Cell } from '../../types';
import type { RangeAddress } from '../../selection/Range';

export interface MoveRangeArgs {
  readonly source: RangeAddress;
  readonly target: RangeAddress;
}

type CellMatrix = readonly (readonly (Cell | undefined)[])[];

export class MoveRange extends Command<MoveRangeArgs> {
  private sourceSnapshot: CellMatrix = [];
  private targetSnapshot: CellMatrix = [];

  public execute(store: Store): void {
    const { source, target } = this.args;
    const srcRows = source.r2 - source.r1 + 1;
    const srcCols = source.c2 - source.c1 + 1;

    // Snapshot source cells
    this.sourceSnapshot = snapshotRange(store, source);
    // Snapshot target cells (for undo)
    const targetEnd = {
      r1: target.r1, c1: target.c1,
      r2: target.r1 + srcRows - 1, c2: target.c1 + srcCols - 1,
    };
    this.targetSnapshot = snapshotRange(store, targetEnd);

    // Write source cells to target location
    for (let r = 0; r < srcRows; r += 1) {
      for (let c = 0; c < srcCols; c += 1) {
        const cell = this.sourceSnapshot[r]?.[c];
        store.setCell(target.r1 + r, target.c1 + c, cell);
      }
    }

    // Clear source cells
    for (let r = source.r1; r <= source.r2; r += 1) {
      for (let c = source.c1; c <= source.c2; c += 1) {
        store.setCell(r, c, undefined);
      }
    }
  }

  public getUndo(): Command {
    return new RestoreMoveRange({
      source: this.args.source,
      target: {
        r1: this.args.target.r1, c1: this.args.target.c1,
        r2: this.args.target.r1 + (this.args.source.r2 - this.args.source.r1),
        c2: this.args.target.c1 + (this.args.source.c2 - this.args.source.c1),
      },
      sourceSnapshot: this.sourceSnapshot,
      targetSnapshot: this.targetSnapshot,
    });
  }

  public override describe(): string {
    const s = this.args.source;
    const t = this.args.target;
    return `MoveRange ${s.r1},${s.c1}:${s.r2},${s.c2} → ${t.r1},${t.c1}`;
  }
}

interface RestoreMoveRangeArgs {
  readonly source: RangeAddress;
  readonly target: RangeAddress;
  readonly sourceSnapshot: CellMatrix;
  readonly targetSnapshot: CellMatrix;
}

class RestoreMoveRange extends Command<RestoreMoveRangeArgs> {
  public execute(store: Store): void {
    const { source, target, sourceSnapshot, targetSnapshot } = this.args;
    const srcRows = source.r2 - source.r1 + 1;
    const srcCols = source.c2 - source.c1 + 1;

    // Restore target cells
    for (let r = 0; r < srcRows; r += 1) {
      for (let c = 0; c < srcCols; c += 1) {
        const cell = targetSnapshot[r]?.[c];
        store.setCell(target.r1 + r, target.c1 + c, cell);
      }
    }

    // Restore source cells
    for (let r = 0; r < srcRows; r += 1) {
      for (let c = 0; c < srcCols; c += 1) {
        const cell = sourceSnapshot[r]?.[c];
        store.setCell(source.r1 + r, source.c1 + c, cell);
      }
    }
  }

  public getUndo(): Command {
    return new MoveRange({
      source: this.args.source,
      target: this.args.target,
    });
  }
}

function snapshotRange(store: Store, range: RangeAddress): CellMatrix {
  const rows: (Cell | undefined)[][] = [];
  for (let r = range.r1; r <= range.r2; r += 1) {
    const row: (Cell | undefined)[] = [];
    for (let c = range.c1; c <= range.c2; c += 1) {
      row.push(store.getCell(r, c));
    }
    rows.push(row);
  }
  return rows;
}
