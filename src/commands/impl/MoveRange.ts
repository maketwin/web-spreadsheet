import { Command } from '../Command';
import { mergeToString, parseMerge, rangeContains, rangesIntersect } from '../../util/merge';
import type { Store } from '../../store/Store';
import type { Cell } from '../../types';
import type { RangeAddress } from '../../selection/Range';

export interface MoveRangeArgs {
  readonly source: RangeAddress;
  readonly target: RangeAddress;
  /** Excel Ctrl+drag: duplicate instead of move — the source cells stay. */
  readonly copy?: boolean;
  /** Target sheet; defaults to the active sheet at execution time. */
  readonly sheetId?: string;
}

type CellMatrix = readonly (readonly (Cell | undefined)[])[];

export class MoveRange extends Command<MoveRangeArgs> {
  private sourceSnapshot: CellMatrix = [];
  private targetSnapshot: CellMatrix = [];
  private sourceMerges: string[] = [];
  private targetMerges: string[] = [];
  private movedMerges: string[] = [];
  private execSheetId: string | undefined;

  public execute(store: Store): void {
    const { source, target } = this.args;
    const sid = this.args.sheetId ?? this.execSheetId ?? store.getActiveSheetId();
    this.execSheetId = sid;
    const srcRows = source.r2 - source.r1 + 1;
    const srcCols = source.c2 - source.c1 + 1;

    // Snapshot source cells
    this.sourceSnapshot = snapshotRange(store, source, sid);
    // Snapshot target cells (for undo)
    const targetEnd = {
      r1: target.r1, c1: target.c1,
      r2: target.r1 + srcRows - 1, c2: target.c1 + srcCols - 1,
    };
    this.targetSnapshot = snapshotRange(store, targetEnd, sid);

    // Write source cells to target location
    for (let r = 0; r < srcRows; r += 1) {
      for (let c = 0; c < srcCols; c += 1) {
        const cell = this.sourceSnapshot[r]?.[c];
        store.setCell(target.r1 + r, target.c1 + c, cell, sid);
      }
    }

    // Clear source cells (Excel Ctrl+drag copy keeps the source)
    if (this.args.copy !== true) {
      for (let r = source.r1; r <= source.r2; r += 1) {
        for (let c = source.c1; c <= source.c2; c += 1) {
          store.setCell(r, c, undefined, sid);
        }
      }
    }

    // Excel: merges fully inside the moved block travel with it.
    this.sourceMerges = [];
    this.targetMerges = store.getMerges(sid).filter((m) => rangesIntersect(parseMerge(m), targetEnd));
    const moved: string[] = [];
    for (const m of store.getMerges(sid)) {
      const a = parseMerge(m);
      if (rangeContains(source, a)) {
        this.sourceMerges.push(m);
        moved.push(mergeToString({ r1: a.r1 - source.r1 + target.r1, c1: a.c1 - source.c1 + target.c1, r2: a.r2 - source.r1 + target.r1, c2: a.c2 - source.c1 + target.c1 }));
      }
    }
    this.movedMerges = moved;
    store.batch(() => {
      // Drop merges the block overwrites at the target; relocate source merges.
      // The guard is checked after the removals so a copy onto its own merge
      // (target overlaps source) re-adds it instead of losing it.
      this.targetMerges.forEach((m) => store.removeMerge(m, sid));
      if (this.args.copy !== true) this.sourceMerges.forEach((m) => store.removeMerge(m, sid));
      moved.forEach((m) => { if (!store.getMerges(sid).includes(m)) store.addMerge(m, sid); });
    });
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
      sourceMerges: this.sourceMerges,
      targetMerges: this.targetMerges,
      movedMerges: this.movedMerges,
      copy: this.args.copy === true,
      ...(this.execSheetId !== undefined ? { sheetId: this.execSheetId } : {}),
    });
  }

  public override describe(): string {
    const s = this.args.source;
    const t = this.args.target;
    return `MoveRange${this.args.copy === true ? ' (copy)' : ''} ${s.r1},${s.c1}:${s.r2},${s.c2} → ${t.r1},${t.c1}`;
  }
}

interface RestoreMoveRangeArgs {
  readonly source: RangeAddress;
  readonly target: RangeAddress;
  readonly sourceSnapshot: CellMatrix;
  readonly targetSnapshot: CellMatrix;
  readonly copy: boolean;
  readonly sourceMerges: readonly string[];
  readonly targetMerges: readonly string[];
  readonly movedMerges: readonly string[];
  readonly sheetId?: string;
}

class RestoreMoveRange extends Command<RestoreMoveRangeArgs> {
  public execute(store: Store): void {
    const { source, target, sourceSnapshot, targetSnapshot } = this.args;
    const sid = this.args.sheetId ?? store.getActiveSheetId();
    const srcRows = source.r2 - source.r1 + 1;
    const srcCols = source.c2 - source.c1 + 1;

    // Restore target cells
    for (let r = 0; r < srcRows; r += 1) {
      for (let c = 0; c < srcCols; c += 1) {
        const cell = targetSnapshot[r]?.[c];
        store.setCell(target.r1 + r, target.c1 + c, cell, sid);
      }
    }

    // Restore source cells (a copy drag never cleared them, but restoring is a no-op then)
    if (!this.args.copy) {
      for (let r = 0; r < srcRows; r += 1) {
        for (let c = 0; c < srcCols; c += 1) {
          const cell = sourceSnapshot[r]?.[c];
          store.setCell(source.r1 + r, source.c1 + c, cell, sid);
        }
      }
    }

    // Restore merge structure: drop relocated merges, bring back the prior ones.
    store.batch(() => {
      this.args.movedMerges.forEach((m) => { if (store.getMerges(sid).includes(m)) store.removeMerge(m, sid); });
      [...this.args.sourceMerges, ...this.args.targetMerges].forEach((m) => { if (!store.getMerges(sid).includes(m)) store.addMerge(m, sid); });
    });
  }

  public getUndo(): Command {
    return new MoveRange({
      source: this.args.source,
      target: this.args.target,
      ...(this.args.copy ? { copy: this.args.copy } : {}),
      ...(this.args.sheetId !== undefined ? { sheetId: this.args.sheetId } : {}),
    });
  }
}

function snapshotRange(store: Store, range: RangeAddress, sheetId: string): CellMatrix {
  const rows: (Cell | undefined)[][] = [];
  for (let r = range.r1; r <= range.r2; r += 1) {
    const row: (Cell | undefined)[] = [];
    for (let c = range.c1; c <= range.c2; c += 1) {
      row.push(store.getCell(r, c, sheetId));
    }
    rows.push(row);
  }
  return rows;
}
