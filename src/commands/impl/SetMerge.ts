import { Command } from '../Command';
import { parseMerge, rangesIntersect, mergeToString } from '../../util/merge';
import { Range } from '../../selection/Range';

import type { Store } from '../../store/Store';
import type { Cell } from '../../types';
import type { RangeAddress } from '../../selection/Range';

export interface SetMergeArgs {
  readonly range: string;
  readonly active: boolean;
}

interface MergeSnapshot {
  readonly cells: ReadonlyArray<readonly [number, number, Cell | undefined]>;
  readonly merges: readonly string[];
}

/**
 * Excel merge semantics: merging keeps only the anchor (upper-left) value —
 * every other covered cell is cleared. Overlapping merges inside the target
 * range are replaced by the new merge. Unmerge restores the individual
 * cells (values stay in the anchor cell, as Excel leaves them).
 */
export class SetMerge extends Command<SetMergeArgs> {
  private before: MergeSnapshot | undefined;

  public execute(store: Store): void {
    const target = Range.normalize(parseMerge(this.args.range));
    this.before = snapshotArea(store, target);
    if (this.args.active) {
      applyMerge(store, target);
    } else {
      applyUnmerge(store, target);
    }
  }

  public getUndo(): Command {
    return new RestoreMergeState(this.before);
  }
}

/** Merge Across (Excel): each row of the selection merges independently. */
export interface SetMergeAcrossArgs {
  readonly range: string;
}

export class SetMergeAcross extends Command<SetMergeAcrossArgs> {
  private before: MergeSnapshot | undefined;

  public execute(store: Store): void {
    const target = Range.normalize(parseMerge(this.args.range));
    this.before = snapshotArea(store, target);
    store.batch(() => {
      for (let r = target.r1; r <= target.r2; r += 1) {
        const rowRange: RangeAddress = { r1: r, c1: target.c1, r2: r, c2: target.c2 };
        if (rowRange.c1 === rowRange.c2) continue;
        applyMerge(store, rowRange);
      }
    });
  }

  public getUndo(): Command {
    return new RestoreMergeState(this.before);
  }
}

/** Unmerge every merge intersecting the selection (Excel Unmerge Cells). */
export function applyUnmerge(store: Store, target: RangeAddress): void {
  for (const m of store.getMerges()) {
    const addr = parseMerge(m);
    if (rangesIntersect(addr, target)) store.removeMerge(m);
  }
}

function applyMerge(store: Store, target: RangeAddress): void {
  store.batch(() => {
    // Replace any merge overlapping the target (Excel absorbs them).
    applyUnmerge(store, target);
    // Keep only the anchor value: clear every other covered cell.
    for (let r = target.r1; r <= target.r2; r += 1) {
      for (let c = target.c1; c <= target.c2; c += 1) {
        if (r === target.r1 && c === target.c1) continue;
        if (store.getCell(r, c) !== undefined) store.setCell(r, c, undefined);
      }
    }
    store.addMerge(mergeToString(target));
  });
}

/** Snapshot the cells in the area plus all merges intersecting it. */
function snapshotArea(store: Store, target: RangeAddress): MergeSnapshot {
  const cells: Array<readonly [number, number, Cell | undefined]> = [];
  for (let r = target.r1; r <= target.r2; r += 1) {
    for (let c = target.c1; c <= target.c2; c += 1) {
      cells.push([r, c, store.getCell(r, c)]);
    }
  }
  const merges = store.getMerges().filter((m) => rangesIntersect(parseMerge(m), target));
  return { cells, merges };
}

class RestoreMergeState extends Command<MergeSnapshot | undefined> {
  public execute(store: Store): void {
    const snapshot = this.args;
    if (snapshot === undefined) return;
    store.batch(() => {
      // Remove merges created by the command, restore prior merges and cells.
      snapshot.cells.forEach(([r, c]) => {
        const merge = store.getMergeAt(r, c);
        if (merge !== undefined) store.removeMerge(merge);
      });
      snapshot.merges.forEach((m) => {
        if (!store.getMerges().includes(m)) store.addMerge(m);
      });
      snapshot.cells.forEach(([r, c, cell]) => store.setCell(r, c, cell));
    });
  }

  public getUndo(): Command {
    return this;
  }
}

export interface ApplyMergeChangesArgs {
  readonly add: readonly string[];
  readonly remove: readonly string[];
}

/**
 * Structural merge changes only (no value clearing) — used by paste, where
 * cell values ride in a separate SetRangeValues command of the same undo unit.
 */
export class ApplyMergeChanges extends Command<ApplyMergeChangesArgs> {
  public execute(store: Store): void {
    store.batch(() => {
      this.args.remove.forEach((m) => { if (store.getMerges().includes(m)) store.removeMerge(m); });
      this.args.add.forEach((m) => { if (!store.getMerges().includes(m)) store.addMerge(m); });
    });
  }

  public getUndo(): Command {
    return new ApplyMergeChanges({ add: this.args.remove, remove: this.args.add });
  }
}
