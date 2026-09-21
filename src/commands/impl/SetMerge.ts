import { Command } from '../Command';
import { parseMerge, rangesIntersect, mergeToString } from '../../util/merge';
import { Range } from '../../selection/Range';

import type { Store } from '../../store/Store';
import type { Cell } from '../../types';
import type { RangeAddress } from '../../selection/Range';

export interface SetMergeArgs {
  readonly range: string;
  readonly active: boolean;
  /** Target sheet; defaults to the active sheet at execution time. */
  readonly sheetId?: string;
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
  private noop = false;
  private execSheetId: string | undefined;

  public execute(store: Store): void {
    const target = Range.normalize(parseMerge(this.args.range));
    const sid = this.args.sheetId ?? this.execSheetId ?? store.getActiveSheetId();
    this.execSheetId = sid;
    // Excel: merging a single cell does nothing; unmerging a range without
    // merges does nothing. Neither enters the undo history.
    const singleCell = target.r1 === target.r2 && target.c1 === target.c2;
    const nothingToUnmerge = !this.args.active && store.getMerges(sid).every((m) => !rangesIntersect(parseMerge(m), target));
    if ((this.args.active && singleCell) || nothingToUnmerge) { this.noop = true; this.before = undefined; return; }
    this.noop = false;
    this.before = snapshotArea(store, target, sid);
    if (this.args.active) {
      applyMerge(store, target, sid);
    } else {
      applyUnmerge(store, target, sid);
    }
  }

  public override isNoOp(): boolean {
    return this.noop;
  }

  public getUndo(): Command {
    return new RestoreMergeState(this.before, this.execSheetId);
  }
}

/** Merge Across (Excel): each row of the selection merges independently. */
export interface SetMergeAcrossArgs {
  readonly range: string;
  /** Target sheet; defaults to the active sheet at execution time. */
  readonly sheetId?: string;
}

export class SetMergeAcross extends Command<SetMergeAcrossArgs> {
  private before: MergeSnapshot | undefined;
  private noop = false;
  private execSheetId: string | undefined;

  public execute(store: Store): void {
    const target = Range.normalize(parseMerge(this.args.range));
    const sid = this.args.sheetId ?? this.execSheetId ?? store.getActiveSheetId();
    this.execSheetId = sid;
    // Excel: Merge Across on a single column does nothing.
    if (target.c1 === target.c2) { this.noop = true; this.before = undefined; return; }
    this.noop = false;
    this.before = snapshotArea(store, target, sid);
    store.batch(() => {
      for (let r = target.r1; r <= target.r2; r += 1) {
        const rowRange: RangeAddress = { r1: r, c1: target.c1, r2: r, c2: target.c2 };
        if (rowRange.c1 === rowRange.c2) continue;
        applyMerge(store, rowRange, sid);
      }
    });
  }

  public override isNoOp(): boolean {
    return this.noop;
  }

  public getUndo(): Command {
    return new RestoreMergeState(this.before, this.execSheetId);
  }
}

/** Unmerge every merge intersecting the selection (Excel Unmerge Cells). */
export function applyUnmerge(store: Store, target: RangeAddress, sheetId?: string): void {
  const sid = sheetId ?? store.getActiveSheetId();
  for (const m of store.getMerges(sid)) {
    const addr = parseMerge(m);
    if (rangesIntersect(addr, target)) store.removeMerge(m, sid);
  }
}

function applyMerge(store: Store, target: RangeAddress, sheetId?: string): void {
  store.batch(() => {
    const sid = sheetId ?? store.getActiveSheetId();
    // Replace any merge overlapping the target (Excel absorbs them).
    applyUnmerge(store, target, sid);
    // Keep only the anchor value: clear every other covered cell.
    for (let r = target.r1; r <= target.r2; r += 1) {
      for (let c = target.c1; c <= target.c2; c += 1) {
        if (r === target.r1 && c === target.c1) continue;
        if (store.getCell(r, c, sid) !== undefined) store.setCell(r, c, undefined, sid);
      }
    }
    store.addMerge(mergeToString(target), sid);
  });
}

/** Snapshot the cells in the area plus all merges intersecting it. */
function snapshotArea(store: Store, target: RangeAddress, sheetId?: string): MergeSnapshot {
  const sid = sheetId ?? store.getActiveSheetId();
  const cells: Array<readonly [number, number, Cell | undefined]> = [];
  for (let r = target.r1; r <= target.r2; r += 1) {
    for (let c = target.c1; c <= target.c2; c += 1) {
      cells.push([r, c, store.getCell(r, c, sid)]);
    }
  }
  const merges = store.getMerges(sid).filter((m) => rangesIntersect(parseMerge(m), target));
  return { cells, merges };
}

interface RestoreMergeStateArgs {
  readonly snapshot: MergeSnapshot | undefined;
  readonly sheetId?: string;
}

class RestoreMergeState extends Command<RestoreMergeStateArgs> {
  public constructor(snapshot: MergeSnapshot | undefined, sheetId?: string) {
    super({ snapshot, ...(sheetId !== undefined ? { sheetId } : {}) });
  }

  public execute(store: Store): void {
    const snapshot = this.args.snapshot;
    if (snapshot === undefined) return;
    const sid = this.args.sheetId ?? store.getActiveSheetId();
    store.batch(() => {
      // Remove merges created by the command, restore prior merges and cells.
      snapshot.cells.forEach(([r, c]) => {
        const merge = store.getMergeAt(r, c, sid);
        if (merge !== undefined) store.removeMerge(merge, sid);
      });
      snapshot.merges.forEach((m) => {
        if (!store.getMerges(sid).includes(m)) store.addMerge(m, sid);
      });
      snapshot.cells.forEach(([r, c, cell]) => store.setCell(r, c, cell, sid));
    });
  }

  public getUndo(): Command {
    return this;
  }
}

export interface ApplyMergeChangesArgs {
  readonly add: readonly string[];
  readonly remove: readonly string[];
  /** Target sheet; defaults to the active sheet at execution time. */
  readonly sheetId?: string;
}

/**
 * Structural merge changes only (no value clearing) — used by paste, where
 * cell values ride in a separate SetRangeValues command of the same undo unit.
 */
export class ApplyMergeChanges extends Command<ApplyMergeChangesArgs> {
  private execSheetId: string | undefined;

  public execute(store: Store): void {
    const sid = this.args.sheetId ?? this.execSheetId ?? store.getActiveSheetId();
    this.execSheetId = sid;
    store.batch(() => {
      this.args.remove.forEach((m) => { if (store.getMerges(sid).includes(m)) store.removeMerge(m, sid); });
      this.args.add.forEach((m) => { if (!store.getMerges(sid).includes(m)) store.addMerge(m, sid); });
    });
  }

  public getUndo(): Command {
    return new ApplyMergeChanges({ add: this.args.remove, remove: this.args.add, ...(this.execSheetId !== undefined ? { sheetId: this.execSheetId } : {}) });
  }
}
