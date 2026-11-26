import { formulaText } from '../../util/cell';
import { TOTAL_COLS } from '../../util/gridSize';
import { Command } from '../Command';

import type { Store } from '../../store/Store';
import type { AutoFilterState, Cell, ColMeta, RowMeta } from '../../types';
import type { ConditionalRule } from '../../conditional/ConditionalRule';
import type { ChartSpec, ImageSpec } from '../../charts/types';
import type { ValidationRule } from '../../validation/types';
import type { NamedRangeDef } from '../../namedrange/types';
import type { RowGroupDef } from '../../store/SheetData';

import type { SparklineSpec } from '../../sparkline/types';

/**
 * The affected half-plane of a structural insert/delete: rows (or columns)
 * at or beyond `from` move, everything before it stays put, so band snapshots
 * record only that region instead of the whole sheet.
 */
export interface SheetSnapshotBand {
  readonly axis: 'row' | 'col';
  readonly from: number;
}

export interface SheetSnapshot {
  /**
   * Active-sheet cells stored **by reference**, band-scoped when `band` is
   * set. Cells held by the store are never mutated in place — every write
   * constructs a new object and swaps the reference (SheetData.setCell stores
   * it directly) — so undo can put the very same objects back, no cloning.
   * Out-of-band formula cells are included too: the shift rewrites their
   * references in place wherever the cell itself sits, so undo must restore
   * their pre-shift text.
   */
  readonly cells: ReadonlyArray<readonly [number, number, Cell]>;
  readonly rows: ReadonlyArray<readonly [number, RowMeta]>;
  readonly cols: ReadonlyArray<readonly [number, ColMeta]>;
  readonly merges: readonly string[];
  /** Affected half-plane; undefined captures/restores the whole sheet. */
  readonly band?: SheetSnapshotBand;
  /** Active sheet's row-group intervals — insert/delete row shift them, undo restores them. */
  readonly rowGroups?: ReadonlyArray<RowGroupDef>;
  /** Active sheet's floating chart objects — structural edits shift their anchors, undo restores them. */
  readonly charts?: ReadonlyArray<ChartSpec>;
  /** Active sheet's floating images — shifted like charts, restored on undo. */
  readonly images?: ReadonlyArray<ImageSpec>;
  /** Active sheet's sparklines — shifted with their host cell and range, restored on undo. */
  readonly sparklines?: ReadonlyArray<SparklineSpec>;
  /**
   * Other sheets' formula cells (sheetId, r, c) — cross-sheet formula
   * rewrites undo here. Structural commands rewrite nothing else on other
   * sheets, so plain cells are neither captured nor wiped on restore.
   */
  readonly otherCells?: ReadonlyArray<readonly [string, number, number, Cell]>;
  /** Per-sheet named ranges (sheetId, name, def) — insert/delete rewrites them. */
  readonly namedRanges?: ReadonlyArray<readonly [string, string, NamedRangeDef]>;
  /** Per-sheet conditional-format ranges (sheetId, range, rules). */
  readonly conditionalRules?: ReadonlyArray<readonly [string, string, ConditionalRule[]]>;
  /** Per-sheet validation ranges (sheetId, range, rule). */
  readonly validationRules?: ReadonlyArray<readonly [string, string, ValidationRule]>;
  /** Per-sheet autofilter state (sheetId, state). */
  readonly autoFilters?: ReadonlyArray<readonly [string, AutoFilterState]>;
}

export function captureSheet(store: Store, sheetId?: string, band?: SheetSnapshotBand): SheetSnapshot {
  const activeId = sheetId ?? store.getActiveSheetId();
  const inBand = (r: number, c: number): boolean =>
    band === undefined || (band.axis === 'row' ? r >= band.from : c >= band.from);
  // Numeric sweeps — no "r,c" string keys, only stored cells are visited.
  const cells: Array<readonly [number, number, Cell]> = [];
  store.forEachCell((r, c, cell) => {
    if (inBand(r, c) || formulaText(cell) !== undefined) cells.push([r, c, cell]);
  }, activeId);
  const otherCells: Array<readonly [string, number, number, Cell]> = [];
  for (const { id } of store.getSheets()) {
    if (id === activeId) continue;
    store.forEachCell((r, c, cell) => {
      if (formulaText(cell) === undefined) return; // only formulas get rewritten cross-sheet
      otherCells.push([id, r, c, cell]);
    }, id);
  }
  return {
    ...captureFeatures(store, activeId),
    cells,
    // With a band, the orthogonal axis' metadata never moves and is neither captured nor reset.
    rows: band?.axis === 'col' ? [] : collectRows(store, activeId, band?.axis === 'row' ? band.from : 0),
    cols: band?.axis === 'row' ? [] : collectCols(store, activeId, band?.axis === 'col' ? band.from : 0),
    ...(band !== undefined ? { band } : {}),
    otherCells,
  };
}

/**
 * The small-widget half of a snapshot — merges, row groups, charts, images
 * and sparklines of `sheetId`, plus the whole workbook's named ranges,
 * conditional formats, validation rules and autofilters — with NO cells.
 * The structural-move undo carries the moved cells themselves; only these
 * features ride along.
 */
export function captureFeatures(store: Store, sheetId?: string): SheetSnapshot {
  const activeId = sheetId ?? store.getActiveSheetId();
  const namedRanges: Array<readonly [string, string, NamedRangeDef]> = [];
  const conditionalRules: Array<readonly [string, string, ConditionalRule[]]> = [];
  const validationRules: Array<readonly [string, string, ValidationRule]> = [];
  const autoFilters: Array<readonly [string, AutoFilterState]> = [];
  for (const { id } of store.getSheets()) {
    store.getNamedRanges(id).forEach(([name, def]) => namedRanges.push([id, name, def]));
    store.getConditionalRules(id).forEach(([range, rules]) => conditionalRules.push([id, range, rules]));
    store.getValidationRules(id).forEach(([range, rule]) => validationRules.push([id, range, rule]));
    const af = store.getAutoFilter(id);
    if (af !== undefined) autoFilters.push([id, af]);
  }
  return {
    cells: [],
    rows: [],
    cols: [],
    merges: store.getMerges(activeId),
    rowGroups: store.getRowGroups(activeId),
    charts: store.getCharts(activeId).map((chart) => chart.anchor === undefined
      ? { ...chart }
      : { ...chart, anchor: { from: { ...chart.anchor.from }, to: { ...chart.anchor.to } } }),
    images: store.getImages(activeId).map((image) => ({
      ...image,
      anchor: { from: { ...image.anchor.from }, to: { ...image.anchor.to } },
    })),
    sparklines: store.getSparklines(activeId).map((sparkline) => ({ ...sparkline })),
    otherCells: [],
    namedRanges,
    conditionalRules,
    validationRules,
    autoFilters,
  };
}

export function restoreSheet(store: Store, snapshot: SheetSnapshot, sheetId?: string): void {
  const sid = sheetId ?? store.getActiveSheetId();
  const band = snapshot.band;
  const from = band?.from ?? 0;
  const inBand = (r: number, c: number): boolean => (band?.axis ?? 'row') === 'row' ? r >= from : c >= from;
  // Collect the band's stored cells first. A stale cell the snapshot
  // restores anyway skips its clearing event — the incoming write lands on
  // the same key — so the undo costs about one event per stored cell and
  // direct Store delivery stays event-by-event (no batch here).
  const restored = new Set(snapshot.cells.map(([r, c]) => r * TOTAL_COLS + c));
  const stale: Array<readonly [number, number]> = [];
  store.forEachCell((r, c) => {
    if (inBand(r, c) && !restored.has(r * TOTAL_COLS + c)) stale.push([r, c]);
  }, sid);
  for (const [r, c] of stale) store.setCell(r, c, undefined, sid);
  snapshot.cells.forEach(([r, c, cell]) => store.setCell(r, c, cell, sid));
  // Only the band axis is reset: the orthogonal metadata never moved, and a
  // band snapshot does not even record it. Only indices that actually carry
  // metadata are cleared — clearing an empty index fires an event for nothing.
  if (band === undefined || band.axis === 'row') {
    for (const [r] of store.getRowEntries(sid)) {
      if (r >= from) store.setRow(r, undefined, sid);
    }
    snapshot.rows.forEach(([r, meta]) => store.setRow(r, meta, sid));
  }
  if (band === undefined || band.axis === 'col') {
    for (const [c] of store.getColEntries(sid)) {
      if (c >= from) store.setCol(c, undefined, sid);
    }
    snapshot.cols.forEach(([c, meta]) => store.setCol(c, meta, sid));
  }
  restoreFeatures(store, snapshot, sid);
  restoreOtherCells(store, snapshot.otherCells ?? []);
}

/** Reset the target sheet's merges / row groups / charts / images /
 * sparklines, and the workbook's named ranges / conditional formats /
 * validation rules / autofilters, to a snapshot. */
export function restoreFeatures(store: Store, snapshot: SheetSnapshot, sheetId?: string): void {
  const sid = sheetId ?? store.getActiveSheetId();
  store.getMerges(sid).forEach((range) => store.removeMerge(range, sid));
  snapshot.merges.forEach((range) => store.addMerge(range, sid));
  if (snapshot.rowGroups !== undefined) store.setRowGroups(snapshot.rowGroups, sid);
  restoreCharts(store, snapshot.charts ?? [], sid);
  restoreImages(store, snapshot.images ?? [], sid);
  restoreSparklines(store, snapshot.sparklines ?? [], sid);
  restoreStructures(store, snapshot);
}

/** Reset the active sheet's floating charts to the snapshot (anchor-shift undo). */
function restoreCharts(store: Store, charts: ReadonlyArray<ChartSpec>, sheetId: string): void {
  store.getCharts(sheetId).forEach((chart) => store.removeChart(chart.id, sheetId));
  charts.forEach((chart) => store.addChart(chart, sheetId));
}

/** Reset the active sheet's floating images to the snapshot (anchor-shift undo). */
function restoreImages(store: Store, images: ReadonlyArray<ImageSpec>, sheetId: string): void {
  store.getImages(sheetId).forEach((image) => store.removeImage(image.id, sheetId));
  images.forEach((image) => store.addImage(image, sheetId));
}

/** Reset the active sheet's sparklines to the snapshot (position/range shift undo). */
function restoreSparklines(store: Store, sparklines: ReadonlyArray<SparklineSpec>, sheetId: string): void {
  store.getSparklines(sheetId).forEach((sparkline) => store.removeSparkline(sparkline.id, sheetId));
  sparklines.forEach((sparkline) => store.addSparkline(sparkline, sheetId));
}

/** Reset named ranges / conditional formats / validation / autofilters to the snapshot. */
function restoreStructures(store: Store, snapshot: SheetSnapshot): void {
  const namedRanges = snapshot.namedRanges ?? [];
  const conditionalRules = snapshot.conditionalRules ?? [];
  const validationRules = snapshot.validationRules ?? [];
  const autoFilters = snapshot.autoFilters ?? [];
  for (const { id } of store.getSheets()) {
    store.getNamedRanges(id).forEach(([name]) => store.removeNamedRange(name, id));
    store.getConditionalRules(id).forEach(([range]) => store.removeConditionalRule(range, id));
    store.getValidationRules(id).forEach(([range]) => store.removeValidationRule(range, id));
    store.setAutoFilter(undefined, id);
  }
  namedRanges.forEach(([id, name, def]) => store.setNamedRange(name, def, id));
  conditionalRules.forEach(([id, range, rules]) => store.setConditionalRule(range, rules, id));
  validationRules.forEach(([id, range, rule]) => store.setValidationRule(range, rule, id));
  autoFilters.forEach(([id, state]) => store.setAutoFilter(state, id));
}

/** Put every other sheet's snapshotted formula cell back. Structural commands
 * rewrite cross-sheet formulas but never touch other sheets' plain cells, so
 * nothing needs wiping here — the old whole-cell snapshot deleted every cell
 * missing from the snapshot, which was pure overhead once only formulas ride. */
export function restoreOtherCells(store: Store, cells: ReadonlyArray<readonly [string, number, number, Cell]>): void {
  for (const [sheetId, r, c, cell] of cells) store.setCell(r, c, cell, sheetId);
}

export function parseKey(key: string): readonly [number, number] {
  const [row, col] = key.split(',');
  if (row === undefined || col === undefined) throw new Error(`Invalid cell key: ${key}`);
  return [Number.parseInt(row, 10), Number.parseInt(col, 10)];
}

/** Only indices that carry metadata — the address space is not an allocation. */
function collectRows(store: Store, sheetId: string, from = 0): ReadonlyArray<readonly [number, RowMeta]> {
  return store.getRowEntries(sheetId).filter(([r]) => r >= from);
}

function collectCols(store: Store, sheetId: string, from = 0): ReadonlyArray<readonly [number, ColMeta]> {
  return store.getColEntries(sheetId).filter(([c]) => c >= from);
}

/** Metadata (row heights, hidden flags, col widths) of the moving region,
 * captured BEFORE the move — undo puts each entry back at its original index. */
export function captureMetaBand(store: Store, axis: 'row' | 'col', from: number, sheetId?: string): ReadonlyArray<readonly [number, RowMeta] | readonly [number, ColMeta]> {
  const sid = sheetId ?? store.getActiveSheetId();
  return axis === 'row'
    ? store.getRowEntries(sid).filter(([r]) => r >= from).map(([r, meta]) => [r, meta] as const)
    : store.getColEntries(sid).filter(([c]) => c >= from).map(([c, meta]) => [c, meta] as const);
}

/** Elementwise RowGroupDef equality — lets structural commands skip no-op
 * `setRowGroups` writes (each write emits a `rowGroups` event). */
export function sameRowGroups(a: readonly RowGroupDef[], b: readonly RowGroupDef[]): boolean {
  return a.length === b.length && a.every((g, i) => b[i]!.start === g.start && b[i]!.end === g.end);
}

/**
 * Everything one structural move (or a multi-span move like RemoveDuplicates)
 * must remember to undo exactly — no band snapshot: the payload is the moved
 * cells themselves, the rewritten formulas, the thin metadata band and the
 * small features. O(removed cells + rewritten formulas + metadata rows).
 */
export interface StructuralMoveUndo {
  readonly axis: 'row' | 'col';
  readonly kind: 'insert' | 'delete';
  readonly sheetId: string;
  /** The moved spans, ascending `[start, count]` (one for the four structural commands). */
  readonly spans: ReadonlyArray<readonly [number, number]>;
  /** Cells taken from deleted rows/cols or pushed off the grid, keyed `r * TOTAL_COLS + c`. */
  readonly removed: ReadonlyArray<readonly [number, Cell]>;
  /** Rewritten formulas: [sheetId, r, c, previousCell] at their ORIGINAL coordinates. */
  readonly rewrites: ReadonlyArray<readonly [string, number, number, Cell]>;
  /** Metadata of the moving region, at original indices. */
  readonly metaBand: ReadonlyArray<readonly [number, RowMeta] | readonly [number, ColMeta]>;
  /** Feature snapshot (no cells). */
  readonly features: SheetSnapshot;
}

/**
 * Undo one structural move: inverse store operation, removed cells back,
 * rewritten formulas' pre-move objects back at their original coordinates,
 * metadata band and features restored. Delivers one `structure` event (the
 * inverse move) plus one `cells` event and the thin feature/metadata events.
 */
export function undoStructuralMove(store: Store, undo: StructuralMoveUndo): void {
  const { axis, kind, sheetId: sid } = undo;
  // The inverse move, spans lowest first: each insert only shifts the
  // half-plane at/after its start, so bands opened earlier (all empty until
  // the bulk write) stay put and every original start stays valid.
  const ordered = [...undo.spans].sort((a, b) => a[0] - b[0]);
  for (const [start, spanCount] of ordered) {
    if (axis === 'row') {
      if (kind === 'insert') store.deleteRows(start, spanCount, sid);
      else store.insertRows(start, spanCount, sid);
    } else if (kind === 'insert') store.deleteCols(start, spanCount, sid);
    else store.insertCols(start, spanCount, sid);
  }
  if (undo.removed.length > 0) store.bulkSetCells(undo.removed, sid);
  // The rewrite records carry ORIGINAL coordinates (each command converts its
  // own single-span captures at execute time; RemoveDuplicates keeps entries
  // original as the spans above them delete).
  for (const [id, r, c, previous] of undo.rewrites) {
    store.setCell(r, c, previous, id);
  }
  if (axis === 'row') {
    for (const [r] of store.getRowEntries(sid)) {
      if (r >= undo.spans[0]![0]) store.setRow(r, undefined, sid);
    }
    for (const entry of undo.metaBand) store.setRow(entry[0], entry[1] as RowMeta, sid);
  } else {
    for (const [c] of store.getColEntries(sid)) {
      if (c >= undo.spans[0]![0]) store.setCol(c, undefined, sid);
    }
    for (const entry of undo.metaBand) store.setCol(entry[0], entry[1] as ColMeta, sid);
  }
  restoreFeatures(store, undo.features, sid);
}

/**
 * Executes a structural move's undo and offers the original command back as
 * its own undo (so redo re-runs it, as CommandManager expects).
 */
export class RestoreStructuralMoveCommand extends Command<{ undo: StructuralMoveUndo | undefined; redoOf: Command }> {
  public constructor(undo: StructuralMoveUndo | undefined, redoOf: Command) {
    super({ undo, redoOf });
  }

  public execute(store: Store): void {
    if (this.args.undo !== undefined) undoStructuralMove(store, this.args.undo);
  }

  public getUndo(): Command {
    return this.args.redoOf;
  }
}
