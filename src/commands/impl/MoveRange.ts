import { Command } from '../Command';
import { mergeToString, parseMerge, rangeContains, rangesIntersect } from '../../util/merge';
import { isSpillShadow } from '../../util/spillShadow';
import { TOTAL_COLS } from '../../util/gridSize';
import type { Store } from '../../store/Store';
import type { Cell } from '../../types';
import type { RangeAddress } from '../../selection/Range';

function cloneCell(cell: Cell | undefined): Cell | undefined {
  if (cell === undefined) return undefined;
  return {
    ...cell,
    ...(cell.richText !== undefined ? { richText: cell.richText.map((run) => ({ ...run, ...(run.style !== undefined ? { style: { ...run.style } } : {}) })) } : {}),
    ...(cell.hyperlink !== undefined ? { hyperlink: { ...cell.hyperlink } } : {}),
  };
}

export interface MoveRangeArgs {
  readonly source: RangeAddress;
  readonly target: RangeAddress;
  /** Excel Ctrl+drag: duplicate instead of move — the source cells stay. */
  readonly copy?: boolean;
  /** Target sheet; defaults to the active sheet at execution time. */
  readonly sheetId?: string;
}

/** Sparse snapshot: only the stored cells of a range, with their coordinates.
 * A move of a whole column must not allocate a matrix over the address space. */
type SparseCells = ReadonlyArray<readonly [number, number, Cell]>;

function snapshotSparse(store: Store, range: RangeAddress, sheetId: string): SparseCells {
  const cells: Array<readonly [number, number, Cell]> = [];
  store.forEachCellInRect(range, (r, c, cell) => cells.push([r, c, cell]), sheetId);
  return cells;
}

export class MoveRange extends Command<MoveRangeArgs> {
  private sourceSnapshot: SparseCells = [];
  private targetSnapshot: SparseCells = [];
  private sourceMerges: string[] = [];
  private targetMerges: string[] = [];
  private movedMerges: string[] = [];
  private execSheetId: string | undefined;

  public override kind(): 'moveRange' { return 'moveRange'; }

  /** Retained payload: the sparse source and target snapshots (merge strings are a handful). */
  public override historyWeight(): number {
    return this.sourceSnapshot.length + this.targetSnapshot.length;
  }

  public execute(store: Store): void {
    const { source, target } = this.args;
    const sid = this.args.sheetId ?? this.execSheetId ?? store.getActiveSheetId();
    this.execSheetId = sid;
    const srcRows = source.r2 - source.r1 + 1;
    const srcCols = source.c2 - source.c1 + 1;

    // Snapshot source cells
    this.sourceSnapshot = snapshotSparse(store, source, sid);
    // Snapshot target cells (for undo)
    const targetEnd = {
      r1: target.r1, c1: target.c1,
      r2: target.r1 + srcRows - 1, c2: target.c1 + srcCols - 1,
    };
    this.targetSnapshot = snapshotSparse(store, targetEnd, sid);

    // Source cell offsets, to see which target positions the move fills.
    const sourceOffsets = new Set(this.sourceSnapshot.map(([r, c]) => (r - source.r1) * srcCols + (c - source.c1)));

    // Write the stored source cells to the target location; target positions
    // the move does not fill are cleared. Spill shadows are derived — the
    // moved anchor formula re-spills over the cleared target positions.
    // No batch here: every position receives at most one write, and direct
    // Store delivery stays event-by-event (CommandManager batches anyway).
    for (const [r, c, cell] of this.sourceSnapshot) {
      const written = isSpillShadow(cell) ? undefined : cloneCell(cell);
      store.setCell(target.r1 + (r - source.r1), target.c1 + (c - source.c1), written, sid);
    }
    for (const [r, c] of this.targetSnapshot) {
      const dr = r - target.r1;
      const dc = c - target.c1;
      if (!sourceOffsets.has(dr * srcCols + dc)) store.setCell(r, c, undefined, sid);
    }

    // Clear source cells that are not part of the destination. An overlapping
    // move (A1:A2 → A2:A3) would otherwise wipe values just written into the
    // intersection. Ctrl+drag copy keeps the source. Only stored cells can
    // need clearing — blanks stay blank.
    if (this.args.copy !== true) {
      for (const [r, c] of this.sourceSnapshot) {
        const inTarget = r >= targetEnd.r1 && r <= targetEnd.r2 && c >= targetEnd.c1 && c <= targetEnd.c2;
        if (!inTarget) store.setCell(r, c, undefined, sid);
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
  readonly sourceSnapshot: SparseCells;
  readonly targetSnapshot: SparseCells;
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

    // Positions the move filled (one per stored source cell); the pre-move
    // target cells they must get back are the sparse target snapshot.
    const targetStored = new Set(targetSnapshot.map(([r, c]) => r * TOTAL_COLS + c));

    // A moved position with no recorded pre-move cell was empty before: clear it.
    for (const [r, c] of sourceSnapshot) {
      const pr = target.r1 + (r - source.r1);
      const pc = target.c1 + (c - source.c1);
      if (!targetStored.has(pr * TOTAL_COLS + pc)) store.setCell(pr, pc, undefined, sid);
    }
    // Restore target cells
    for (const [r, c, cell] of targetSnapshot) store.setCell(r, c, cell, sid);

    // Restore source cells (a copy drag never cleared them, but restoring is a no-op then)
    if (!this.args.copy) {
      for (const [r, c, cell] of sourceSnapshot) store.setCell(r, c, cell, sid);
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
