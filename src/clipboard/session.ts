import type { Store } from '../store/Store';
import type { RangeAddress } from '../selection/Range';
import type { Cell } from '../types';
import { shiftFormula } from '../commands/impl/FillRange';
import { type CellPatch } from '../commands/impl/SetRangeValues';
import type { Command } from '../commands/Command';
import { ClipboardService, copySourceRect } from './ClipboardService';
import { makeCopyStyleInterner } from '../commands/impl/styleIdentity';
import { mergeToString, parseMerge, rangesIntersect, sameRange } from '../util/merge';
import { applyMatrix, ClearCellsCommand } from '../commands/rangeValues';
import { isSpillShadow } from '../util/spillShadow';
import { MAX_MATERIALIZED_CELLS } from '../util/limits';
import type { CommandManager } from '../commands/CommandManager';

/** `sheetId` is the sheet the block was copied from: a paste that lands on another sheet re-registers its styles there and, for a cut, clears the source there. */
export interface ClipboardSessionState { readonly type: 'cut' | 'copy'; readonly sheetId?: string; readonly range: RangeAddress; readonly text: string; readonly cells: ReadonlyArray<ReadonlyArray<Cell | undefined>>; readonly merges?: readonly RangeAddress[] }

/**
 * Style ids are sheet-local: the same id means different styles on two
 * sheets, or nothing at all. A paste landing on another sheet therefore
 * registers each source style on the target sheet (once per source id, and
 * reused across pastes when the content is identical).
 */
export function retargetPasteStyles(store: Store, patches: readonly (readonly (CellPatch | undefined)[])[], fromSheetId: string, toSheetId: string): (CellPatch | undefined)[][] {
  const mapped = new Map<string, string>();
  const intern = (sourceId: string): string => {
    const known = mapped.get(sourceId);
    if (known !== undefined) return known;
    const style = store.getStyle(sourceId, fromSheetId);
    let next = sourceId;
    if (style !== undefined) {
      const base = `xp-${sourceId}`;
      next = base;
      for (let n = 2; store.getStyle(next, toSheetId) !== undefined && JSON.stringify(store.getStyle(next, toSheetId)) !== JSON.stringify(style); n += 1) next = `${base}-${n}`;
      store.setStyle(next, style, toSheetId);
    }
    mapped.set(sourceId, next);
    return next;
  };
  return patches.map((row) => row.map((patch) => patch === undefined || patch.styleId === undefined ? patch : { ...patch, styleId: intern(patch.styleId) }));
}

/** Merges fully inside the copied range ride along on paste (Excel replicates the merge structure). */
export function snapshotMerges(store: Store, range: RangeAddress): readonly RangeAddress[] {
  const out: RangeAddress[] = [];
  for (const m of store.getMerges()) {
    const a = parseMerge(m);
    if (a.r1 >= range.r1 && a.c1 >= range.c1 && a.r2 <= range.r2 && a.c2 <= range.c2) out.push(a);
  }
  return out;
}

export type MergePasteError = 'size-mismatch' | 'plain-over-merged';

export interface MergePastePlan {
  readonly ok: boolean;
  readonly rect: RangeAddress;
  readonly add: readonly string[];
  readonly error?: MergePasteError;
}

/** Excel's two merge-paste refusal messages, keyed by cause. */
export function mergePasteErrorMessage(error: MergePasteError | undefined): string {
  return error === 'plain-over-merged' ? '不能对合并单元格执行此操作' : '此操作要求合并单元格都具有相同大小';
}

/**
 * Excel paste validation: every merge intersecting the paste rectangle must
 * exactly match a merge the paste would create — otherwise Excel refuses with
 * 「此操作要求合并单元格都具有相同大小」 (or 「不能对合并单元格执行此操作」
 * when the clipboard itself carries no merges). Source merges are replicated
 * per tile (exact-multiple targets tile the whole clipboard block).
 */
export function planMergePaste(store: Store, sourceMerges: readonly RangeAddress[], sourceRange: RangeAddress, r: number, c: number, target?: RangeAddress): MergePastePlan {
  const srcRows = sourceRange.r2 - sourceRange.r1 + 1;
  const srcCols = sourceRange.c2 - sourceRange.c1 + 1;
  const [rows, cols] = tiledDims(srcRows, srcCols, target);
  const rect: RangeAddress = { r1: r, c1: c, r2: r + rows - 1, c2: c + cols - 1 };
  // Excel: pasting a single plain cell into a merged cell keeps the merge — a
  // merged cell is one cell, so the value lands in its anchor only.
  if (sourceMerges.length === 0 && srcRows === 1 && srcCols === 1) {
    const merge = store.getMergeAt(r, c);
    if (merge !== undefined) {
      const addr = parseMerge(merge);
      if (sameRange(addr, rect)) return { ok: true, rect: { r1: addr.r1, c1: addr.c1, r2: addr.r1, c2: addr.c1 }, add: [] };
    }
  }
  const error: MergePasteError = sourceMerges.length === 0 ? 'plain-over-merged' : 'size-mismatch';
  const desired: RangeAddress[] = [];
  for (let i = 0; i < rows; i += srcRows) {
    for (let j = 0; j < cols; j += srcCols) {
      for (const m of sourceMerges) {
        desired.push({ r1: r + i + (m.r1 - sourceRange.r1), c1: c + j + (m.c1 - sourceRange.c1), r2: r + i + (m.r2 - sourceRange.r1), c2: c + j + (m.c2 - sourceRange.c1) });
      }
    }
  }
  for (const m of store.getMerges()) {
    const a = parseMerge(m);
    if (!rangesIntersect(a, rect)) continue;
    if (!desired.some((d) => sameRange(d, a))) return { ok: false, rect, add: [], error };
  }
  const existing = new Set(store.getMerges());
  const add = desired.map(mergeToString).filter((name) => !existing.has(name));
  return { ok: true, rect, add };
}

/** Deep-enough snapshot of the source block so the paste is value/style/formula-faithful. Only the used part of `range` is read (see copySourceRect) — an entire-column copy must not enumerate the grid. Spill shadows are skipped: the pasted anchor formula re-spills, and pasting shadow values would block it. Cells that only LOOK styled through the row/column default get a materialized own styleId (content-interned), so pasting them elsewhere carries the format like Excel. */
export function snapshotCells(store: Store, range: RangeAddress): ReadonlyArray<ReadonlyArray<Cell | undefined>> {
  const rect = copySourceRect(store, range);
  const rows: Array<Array<Cell | undefined>> = Array.from({ length: rect.r2 - rect.r1 + 1 }, () =>
    Array.from({ length: rect.c2 - rect.c1 + 1 }, () => undefined));
  const intern = makeCopyStyleInterner(store);
  store.forEachCellInRect(rect, (r, c, cell) => {
    if (isSpillShadow(cell)) return;
    const snapshot: Cell = { ...cell };
    if (snapshot.styleId === undefined) {
      const effective = store.getCellStyle(r, c, cell);
      if (effective !== undefined) snapshot.styleId = intern(effective);
    }
    rows[r - rect.r1]![c - rect.c1] = snapshot;
  });
  return rows;
}

/**
 * Turn a session snapshot into paste values anchored at (r, c). Copy shifts
 * relative formula references by the paste offset (Excel); cut keeps formulas
 * verbatim (Excel move semantics). Empty source cells clear the target cell.
 */
export function buildSessionPasteValues(session: ClipboardSessionState, r: number, c: number, target?: RangeAddress): CellPatch[][] {
  const srcRows = session.cells.length;
  const srcCols = session.cells[0]?.length ?? 1;
  const [rows, cols] = tiledDims(srcRows, srcCols, target);
  const out: CellPatch[][] = [];
  for (let i = 0; i < rows; i += 1) {
    const line: CellPatch[] = [];
    for (let j = 0; j < cols; j += 1) {
      const cell = session.cells[i % srcRows]?.[j % srcCols];
      if (cell === undefined) { line.push({ text: '', formula: undefined, value: undefined, styleId: undefined, type: undefined, richText: undefined, hyperlink: undefined }); continue; }
      // Formula shift is measured from this tile's source cell, so tiled copies
      // each get their own relative references (Excel).
      const dr = r + i - (session.range.r1 + (i % srcRows));
      const dc = c + j - (session.range.c1 + (j % srcCols));
      // Explicit keys (even undefined) so the paste fully replaces the target
      // cell instead of merging with stale formula/value/style/hyperlink remnants.
      line.push({
        text: cell.text,
        formula: cell.formula !== undefined && session.type === 'copy' ? shiftFormula(cell.formula, dr, dc) : cell.formula,
        value: cell.value,
        styleId: cell.styleId,
        type: cell.type,
        richText: cell.richText,
        hyperlink: cell.hyperlink !== undefined ? { ...cell.hyperlink } : undefined,
      });
    }
    out.push(line);
  }
  return out;
}

/**
 * Excel paste tiling: a target exactly N×M times the copied block gets filled
 * with repeats; anything else pastes a single copy at the anchor. A target big
 * enough that tiling would materialise more than MAX_MATERIALIZED_CELLS (an
 * entire-column selection, say) pastes once at the anchor instead — the
 * address space is not an allocation.
 */
function tiledDims(srcRows: number, srcCols: number, target?: RangeAddress): [number, number] {
  if (target === undefined || srcRows === 0 || srcCols === 0) return [srcRows, srcCols];
  const tr = target.r2 - target.r1 + 1;
  const tc = target.c2 - target.c1 + 1;
  if ((tr > srcRows || tc > srcCols) && tr % srcRows === 0 && tc % srcCols === 0 && tr * tc <= MAX_MATERIALIZED_CELLS) return [tr, tc];
  return [srcRows, srcCols];
}

/** External clipboard paste with Excel tiling for exact-multiple selections. */
export function tilePlainCells(cells: Cell[][], target: RangeAddress): Cell[][] {
  const srcRows = cells.length;
  const srcCols = cells[0]?.length ?? 1;
  const [rows, cols] = tiledDims(srcRows, srcCols, target);
  if (rows === srcRows && cols === srcCols) return cells;
  return Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => cells[i % srcRows]![j % srcCols]!));
}

/**
 * Combine a multi-selection into one rectangular block for copying.
 * Excel allows it only when every range shares the same rows (columns
 * concatenated) or the same columns (rows concatenated); otherwise null.
 * Only the used part of each range is read (see copySourceRect).
 */
export function combineMultiRanges(store: Store, ranges: readonly RangeAddress[]): { range: RangeAddress; cells: ReadonlyArray<ReadonlyArray<Cell | undefined>>; text: string } | null {
  const sorted = [...ranges].sort((a, b) => a.r1 - b.r1 || a.c1 - b.c1);
  const sameRows = sorted.every((rg) => rg.r1 === sorted[0]!.r1 && rg.r2 === sorted[0]!.r2);
  const sameCols = sorted.every((rg) => rg.c1 === sorted[0]!.c1 && rg.c2 === sorted[0]!.c2);
  if (!sameRows && !sameCols) return null;
  const cellRows: Array<ReadonlyArray<Cell | undefined>> = [];
  // Same materialization as snapshotCells: inherited formats travel with the copy.
  const intern = makeCopyStyleInterner(store);
  const snapshotAt = (r: number, c: number): Cell | undefined => {
    const cell = store.getCell(r, c);
    if (cell === undefined || isSpillShadow(cell)) return undefined;
    if (cell.styleId !== undefined) return { ...cell };
    const effective = store.getCellStyle(r, c, cell);
    return effective === undefined ? { ...cell } : { ...cell, styleId: intern(effective) };
  };
  // Shared extent from the union of all ranges, so every line of the block is
  // the same length even when the ranges' stored parts end at different rows
  // or columns.
  const union = sorted.reduce((acc, rg) => ({ r1: Math.min(acc.r1, rg.r1), c1: Math.min(acc.c1, rg.c1), r2: Math.max(acc.r2, rg.r2), c2: Math.max(acc.c2, rg.c2) }));
  if (sameRows) {
    const byCols = [...sorted].sort((a, b) => a.c1 - b.c1);
    const rowsRect = copySourceRect(store, union);
    for (let r = rowsRect.r1; r <= rowsRect.r2; r += 1) {
      const line: Array<Cell | undefined> = [];
      for (const rg of byCols) {
        const rect = copySourceRect(store, rg);
        for (let c = rect.c1; c <= rect.c2; c += 1) { line.push(snapshotAt(r, c)); }
      }
      cellRows.push(line);
    }
  } else {
    const byRows = [...sorted].sort((a, b) => a.r1 - b.r1);
    const colsRect = copySourceRect(store, union);
    for (const rg of byRows) {
      const rect = copySourceRect(store, rg);
      for (let r = rect.r1; r <= rect.r2; r += 1) {
        const line: Array<Cell | undefined> = [];
        for (let c = colsRect.c1; c <= colsRect.c2; c += 1) { line.push(snapshotAt(r, c)); }
        cellRows.push(line);
      }
    }
  }
  const text = cellRows.map((line) => line.map((cell) => cell?.text ?? '').join('\t')).join('\n');
  return { range: union, cells: cellRows, text };
}

/**
 * Cut clears its source: a sparse clear that touches only the stored cells of
 * the source range (an entire-column source must not enumerate the address
 * space, let alone build a dense clear matrix over it). Undo restores exactly
 * the cells that were there — the skipped blanks had nothing to restore.
 */
export function sparseClearCmd(store: Store, range: RangeAddress, sheetId?: string): Command {
  return new ClearCellsCommand({ rect: store.limitToData(range, sheetId), ...(sheetId !== undefined ? { sheetId } : {}) });
}

/** Undoable sparse clear of the active sheet's `range` (the Delete-key / context-menu path). */
export function sparseClearRange(store: Store, cmdManager: CommandManager | undefined, range: RangeAddress): void {
  const cmd = sparseClearCmd(store, range);
  if (cmdManager === undefined) cmd.execute.bind(cmd)(store); else cmdManager.execute.bind(cmdManager)(cmd);
}

export async function pasteFromClipboard(store: Store, cmdManager: CommandManager | undefined, target: RangeAddress): Promise<MergePastePlan> {
  const cells = await ClipboardService.read();
  if (cells.length === 0) return { ok: true, rect: target, add: [] };
  // Plain clipboard data carries no merges; Excel still refuses pasting it over merged cells.
  const sourceRange: RangeAddress = { r1: 0, c1: 0, r2: cells.length - 1, c2: (cells[0]?.length ?? 1) - 1 };
  const plan = planMergePaste(store, [], sourceRange, target.r1, target.c1, target);
  if (!plan.ok) return plan;
  const tiled = tilePlainCells(cells, plan.rect);
  const withStyles = applyPasteStyles(store, tiled, plan.rect.r1, plan.rect.c1);
  // Explicit hyperlink (or undefined) so paste replaces stale links on the target.
  const patches = withStyles.map((row) => row.map((cell) => cellToPastePatch(cell)));
  applyMatrix(store, cmdManager, plan.rect.r1, plan.rect.c1, patches);
  return plan;
}

/** Full-replace paste patch: always names hyperlink so old links cannot linger. */
function cellToPastePatch(cell: Cell | undefined): CellPatch {
  if (cell === undefined) {
    return { text: '', formula: undefined, value: undefined, styleId: undefined, type: undefined, richText: undefined, hyperlink: undefined };
  }
  return {
    text: cell.text,
    formula: cell.formula,
    value: cell.value,
    styleId: cell.styleId,
    type: cell.type,
    richText: cell.richText,
    hyperlink: cell.hyperlink !== undefined ? { ...cell.hyperlink } : undefined,
  };
}

/** Turn ephemeral `pasteStyle` from HTML `<td>` into real styleIds before apply. */
function applyPasteStyles(store: Store, cells: Cell[][], r0: number, c0: number): Cell[][] {
  return cells.map((row, i) => row.map((cell, j) => {
    if (cell === undefined || cell.pasteStyle === undefined) return cell;
    const { pasteStyle, ...rest } = cell;
    const styleId = `paste-${r0 + i}-${c0 + j}-${Date.now() % 1_000_000}`;
    const prev = store.getStyle(styleId);
    store.setStyle(styleId, { ...prev, ...pasteStyle });
    return { ...rest, styleId };
  }));
}
