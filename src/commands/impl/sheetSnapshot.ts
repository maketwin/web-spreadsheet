import { TOTAL_COLS, TOTAL_ROWS } from '../../renderer/CanvasRenderer';

import type { Store } from '../../store/Store';
import type { AutoFilterState, Cell, ColMeta, RowMeta } from '../../types';
import type { ConditionalRule } from '../../conditional/ConditionalRule';
import type { ChartSpec } from '../../charts/types';
import type { ValidationRule } from '../../validation/types';
import type { NamedRangeDef } from '../../namedrange/types';

export interface SheetSnapshot {
  readonly cells: ReadonlyArray<readonly [number, number, Cell]>;
  readonly rows: ReadonlyArray<readonly [number, RowMeta]>;
  readonly cols: ReadonlyArray<readonly [number, ColMeta]>;
  readonly merges: readonly string[];
  /** Active sheet's floating chart objects — structural edits shift their anchors, undo restores them. */
  readonly charts?: ReadonlyArray<ChartSpec>;
  /** Other sheets' cells (sheetId, r, c) — cross-sheet formula rewrites undo here. */
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

export function captureSheet(store: Store, sheetId?: string): SheetSnapshot {
  const activeId = sheetId ?? store.getActiveSheetId();
  const otherCells: Array<readonly [string, number, number, Cell]> = [];
  for (const { id } of store.getSheets()) {
    if (id === activeId) continue;
    for (const [key, cell] of store.getCells(id)) {
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
    cells: store.getCells(activeId).map(([key, cell]) => [...parseKey(key), cell] as const),
    rows: collectRows(store, activeId),
    cols: collectCols(store, activeId),
    merges: store.getMerges(),
    charts: store.getCharts(),
    otherCells,
    namedRanges,
    conditionalRules,
    validationRules,
    autoFilters,
  };
}

export function restoreSheet(store: Store, snapshot: SheetSnapshot, sheetId?: string): void {
  const sid = sheetId ?? store.getActiveSheetId();
  store.getCells(sid).forEach(([key]) => {
    const [r, c] = parseKey(key);
    store.setCell(r, c, undefined, sid);
  });
  for (let r = 0; r < TOTAL_ROWS; r += 1) store.setRow(r, undefined, sid);
  for (let c = 0; c < TOTAL_COLS; c += 1) store.setCol(c, undefined, sid);
  store.getMerges(sid).forEach((range) => store.removeMerge(range, sid));
  snapshot.cells.forEach(([r, c, cell]) => store.setCell(r, c, cell, sid));
  snapshot.rows.forEach(([r, meta]) => store.setRow(r, meta, sid));
  snapshot.cols.forEach(([c, meta]) => store.setCol(c, meta, sid));
  snapshot.merges.forEach((range) => store.addMerge(range, sid));
  restoreCharts(store, snapshot.charts ?? [], sid);
  restoreOtherCells(store, snapshot.otherCells ?? [], sid);
  restoreStructures(store, snapshot);
}

/** Reset the active sheet's floating charts to the snapshot (anchor-shift undo). */
function restoreCharts(store: Store, charts: ReadonlyArray<ChartSpec>, sheetId: string): void {
  store.getCharts(sheetId).forEach((chart) => store.removeChart(chart.id, sheetId));
  charts.forEach((chart) => store.addChart(chart, sheetId));
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

/** Reset every other sheet's cells back to the snapshotted set. `originSheetId`
 * is the sheet the snapshot itself restores — never wipe it here, even when
 * undo runs while a different sheet is active. */
export function restoreOtherCells(store: Store, cells: ReadonlyArray<readonly [string, number, number, Cell]>, originSheetId?: string): void {
  const activeId = store.getActiveSheetId();
  const snapshotted = new Set<string>();
  for (const [sheetId, r, c, cell] of cells) {
    snapshotted.add(`${sheetId}:${r},${c}`);
    store.setCell(r, c, cell, sheetId);
  }
  for (const { id } of store.getSheets()) {
    if (id === activeId) continue; // the active sheet is restored by the snapshot itself
    if (originSheetId !== undefined && id === originSheetId) continue; // the origin sheet too (may differ from active)
    for (const [key] of store.getCells(id)) {
      if (snapshotted.has(`${id}:${key}`)) continue;
      const [r, c] = parseKey(key);
      store.setCell(r, c, undefined, id);
    }
  }
}

export function parseKey(key: string): readonly [number, number] {
  const [row, col] = key.split(',');
  if (row === undefined || col === undefined) throw new Error(`Invalid cell key: ${key}`);
  return [Number.parseInt(row, 10), Number.parseInt(col, 10)];
}

function collectRows(store: Store, sheetId: string): ReadonlyArray<readonly [number, RowMeta]> {
  const rows: Array<readonly [number, RowMeta]> = [];
  for (let r = 0; r < TOTAL_ROWS; r += 1) {
    const meta = store.getRow(r, sheetId);
    if (meta !== undefined) rows.push([r, meta]);
  }
  return rows;
}

function collectCols(store: Store, sheetId: string): ReadonlyArray<readonly [number, ColMeta]> {
  const cols: Array<readonly [number, ColMeta]> = [];
  for (let c = 0; c < TOTAL_COLS; c += 1) {
    const meta = store.getCol(c, sheetId);
    if (meta !== undefined) cols.push([c, meta]);
  }
  return cols;
}
