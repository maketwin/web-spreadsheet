import { formulaText } from '../../util/cell';
import { TOTAL_COLS, TOTAL_ROWS } from '../../util/gridSize';

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
  const cells: Array<readonly [number, number, Cell]> = [];
  for (const [key, cell] of store.getCells(activeId)) {
    const [r, c] = parseKey(key);
    if (inBand(r, c) || formulaText(cell) !== undefined) cells.push([r, c, cell]);
  }
  const otherCells: Array<readonly [string, number, number, Cell]> = [];
  for (const { id } of store.getSheets()) {
    if (id === activeId) continue;
    for (const [key, cell] of store.getCells(id)) {
      if (formulaText(cell) === undefined) continue; // only formulas get rewritten cross-sheet
      const [r, c] = parseKey(key);
      otherCells.push([id, r, c, cell]);
    }
  }
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
    cells,
    // With a band, the orthogonal axis' metadata never moves and is neither captured nor reset.
    rows: band?.axis === 'col' ? [] : collectRows(store, activeId, band?.axis === 'row' ? band.from : 0),
    cols: band?.axis === 'row' ? [] : collectCols(store, activeId, band?.axis === 'col' ? band.from : 0),
    merges: store.getMerges(activeId),
    ...(band !== undefined ? { band } : {}),
    rowGroups: store.getRowGroups(activeId),
    charts: store.getCharts(activeId).map((chart) => chart.anchor === undefined
      ? { ...chart }
      : { ...chart, anchor: { from: { ...chart.anchor.from }, to: { ...chart.anchor.to } } }),
    images: store.getImages(activeId).map((image) => ({
      ...image,
      anchor: { from: { ...image.anchor.from }, to: { ...image.anchor.to } },
    })),
    sparklines: store.getSparklines(activeId).map((sparkline) => ({ ...sparkline })),
    otherCells,
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
  store.getCells(sid).forEach(([key]) => {
    const [r, c] = parseKey(key);
    if (inBand(r, c)) store.setCell(r, c, undefined, sid);
  });
  // Only the band axis is reset: the orthogonal metadata never moved, and a
  // band snapshot does not even record it.
  if (band === undefined || band.axis === 'row') {
    for (let r = from; r < TOTAL_ROWS; r += 1) store.setRow(r, undefined, sid);
    snapshot.rows.forEach(([r, meta]) => store.setRow(r, meta, sid));
  }
  if (band === undefined || band.axis === 'col') {
    for (let c = from; c < TOTAL_COLS; c += 1) store.setCol(c, undefined, sid);
    snapshot.cols.forEach(([c, meta]) => store.setCol(c, meta, sid));
  }
  store.getMerges(sid).forEach((range) => store.removeMerge(range, sid));
  snapshot.cells.forEach(([r, c, cell]) => store.setCell(r, c, cell, sid));
  snapshot.merges.forEach((range) => store.addMerge(range, sid));
  if (snapshot.rowGroups !== undefined) store.setRowGroups(snapshot.rowGroups, sid);
  restoreCharts(store, snapshot.charts ?? [], sid);
  restoreImages(store, snapshot.images ?? [], sid);
  restoreSparklines(store, snapshot.sparklines ?? [], sid);
  restoreOtherCells(store, snapshot.otherCells ?? []);
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

function collectRows(store: Store, sheetId: string, from = 0): ReadonlyArray<readonly [number, RowMeta]> {
  const rows: Array<readonly [number, RowMeta]> = [];
  for (let r = from; r < TOTAL_ROWS; r += 1) {
    const meta = store.getRow(r, sheetId);
    if (meta !== undefined) rows.push([r, meta]);
  }
  return rows;
}

function collectCols(store: Store, sheetId: string, from = 0): ReadonlyArray<readonly [number, ColMeta]> {
  const cols: Array<readonly [number, ColMeta]> = [];
  for (let c = from; c < TOTAL_COLS; c += 1) {
    const meta = store.getCol(c, sheetId);
    if (meta !== undefined) cols.push([c, meta]);
  }
  return cols;
}
