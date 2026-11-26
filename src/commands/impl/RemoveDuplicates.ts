import { Command } from '../Command';
import { captureFeatures, captureMetaBand, RestoreStructuralMoveCommand, sameRowGroups, type StructuralMoveUndo } from './sheetSnapshot';
import { replaceMerges, shiftMergesForDelete } from '../../util/merge';
import { shiftRowGroupsForDelete } from '../../outline/rowGroupShift';
import { shiftSheetFormulas } from './shiftFormulas';
import { shiftSheetChartAnchors } from '../../charts/anchorShift';
import { shiftSheetSparklines } from '../../sparkline/shift';
import { findDuplicateRows } from '../../data/removeDuplicates';
import type { Store } from '../../store/Store';
import type { Cell } from '../../types';

export interface RemoveDuplicatesArgs {
  readonly r1: number;
  readonly c1: number;
  readonly r2: number;
  readonly c2: number;
  /** Column offsets within the range (0 = leftmost). */
  readonly columns: readonly number[];
  readonly hasHeader: boolean;
  /** Target sheet; defaults to the active sheet at execution time. */
  readonly sheetId?: string;
}

/**
 * Excel 删除重复项: delete whole worksheet rows for duplicate keys (first
 * occurrence kept). Contiguous duplicate rows collapse into one span, and
 * every span goes through `Store.deleteRows` bottom-up — one `structure`
 * event per span, spill shadows dropped exactly like DeleteRow, cells moved
 * as one piece. Undo carries no sheet snapshot: the taken cells, the
 * rewritten formulas (kept at their ORIGINAL coordinates as spans delete
 * above them), the metadata band and the small features.
 *
 * Only rows that hold at least one stored cell take part: the address space
 * is not data, so a whole-column dedupe must not "delete" a million empty
 * rows below the table. Keys come from the selected columns exactly as
 * before, so a row that exists but is empty in the key columns still counts
 * as an empty-key row.
 */
export class RemoveDuplicatesCommand extends Command<RemoveDuplicatesArgs> {
  private undoData: StructuralMoveUndo | undefined;
  private removed = 0;
  private execSheetId: string | undefined;

  public override kind(): 'removeDuplicates' { return 'removeDuplicates'; }

  /** Retained payload: taken cells + rewritten formulas + metadata band + features. */
  public override historyWeight(): number {
    const undo = this.undoData;
    if (undo === undefined) return 0;
    return undo.removed.length + undo.rewrites.length + undo.metaBand.length + undo.features.merges.length + 2;
  }

  public execute(store: Store): void {
    const sid = this.args.sheetId ?? this.execSheetId ?? store.getActiveSheetId();
    this.execSheetId = sid;
    const { r1, c1, r2, c2, columns, hasHeader } = this.args;
    if (columns.length === 0 || r2 < r1 || c2 < c1) {
      this.removed = 0;
      this.undoData = { axis: 'row', kind: 'delete', sheetId: sid, spans: [], removed: [], rewrites: [], metaBand: [], features: captureFeatures(store, sid) };
      return;
    }
    const features = captureFeatures(store, sid);
    const metaBand = captureMetaBand(store, 'row', r1, sid);
    const getText = (r: number, c: number): string => {
      const cell = store.getCell(r, c, sid);
      if (cell?.value !== undefined && cell.value !== null && typeof cell.value !== 'object') {
        return String(cell.value);
      }
      return cell?.text ?? '';
    };
    // The stored rows inside the span, ascending.
    const seen = new Set<number>();
    const dataRows: number[] = [];
    store.forEachCell((r) => {
      if (r >= r1 && r <= r2 && !seen.has(r)) {
        seen.add(r);
        dataRows.push(r);
      }
    }, sid);
    dataRows.sort((a, b) => a - b);
    const keys = dataRows.map((r) => columns.map((ci) => getText(r, c1 + ci)));
    const dupRel = findDuplicateRows(keys, { hasHeader });
    const toDelete = dupRel.map((i) => dataRows[i]!).sort((a, b) => a - b);
    this.removed = toDelete.length;
    // Group into contiguous spans, delete bottom-up (highest first), so each
    // span's original start stays valid when its turn comes.
    const spans: Array<readonly [number, number]> = [];
    for (const r of toDelete) {
      const last = spans[spans.length - 1];
      if (last !== undefined && r === last[1] + 1) spans[spans.length - 1] = [last[0], r];
      else spans.push([r, r]);
    }
    const removedCells: Array<readonly [number, Cell]> = [];
    const rewrites: Array<readonly [string, number, number, Cell]> = [];
    for (const [from, to] of [...spans].reverse()) {
      const count = to - from + 1;
      const taken = store.deleteRows(from, count, sid);
      // Rewrites recorded for lower spans sit at coordinates that just moved
      // up: keep them at their ORIGINAL coordinates (undo puts cells back
      // there after the bands are re-inserted).
      for (const entry of rewrites) {
        if (entry[0] === sid && entry[1] >= from + count) (entry as unknown as [string, number, number, Cell])[1] += count;
      }
      const spanRewrites = shiftSheetFormulas(store, 'row', from, -count, sid);
      rewrites.push(...spanRewrites);
      removedCells.push(...taken);
      // Row metadata of the region moves like DeleteRow's (only rows with
      // metadata; each write emits at most 2 events).
      const rows = store.getRowEntries(sid).filter(([r]) => r >= from).sort((a, b) => a[0] - b[0]);
      for (const [r, meta] of rows) {
        if (r >= from + count) store.setRow(r - count, meta, sid);
        store.setRow(r, undefined, sid);
      }
      replaceMerges(store, shiftMergesForDelete(store.getMerges(sid), from, to, 'row'), sid);
      const groups = store.getRowGroups(sid);
      const nextGroups = shiftRowGroupsForDelete(groups, from, to);
      if (!sameRowGroups(nextGroups, groups)) store.setRowGroups(nextGroups, sid);
      shiftSheetChartAnchors(store, 'delete', 'row', from, count, sid);
      shiftSheetSparklines(store, 'delete', 'row', from, count, sid);
    }
    this.undoData = {
      axis: 'row',
      kind: 'delete',
      sheetId: sid,
      spans: spans.map(([from, to]) => [from, to - from + 1] as const), // [start, count], not the inclusive [from, to]
      removed: removedCells,
      rewrites,
      metaBand,
      features,
    };
  }

  public getUndo(): Command {
    return new RestoreStructuralMoveCommand(this.undoData, this);
  }

  public removedCount(): number {
    return this.removed;
  }
}
