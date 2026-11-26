import type { FC } from 'react';
import type { Store } from '../store/Store';
import type { Cell } from '../types';
import type { RangeAddress } from '../selection/Range';

export interface StatusBarProps {
  readonly store: Store;
  readonly selected: RangeAddress | null;
  readonly zoom: number;
  readonly autoSaveStatus?: string;
}

/** Memoized filled-cell count, keyed by (store, active sheet, revision).
 * Every click re-renders the status bar via the parent, but the count only
 * changes when sheet content changes — and content changes always advance
 * Store.revision (selection changes never go through the Store). */
const filledCountCache = new WeakMap<
  Store,
  { readonly sheetId: string; readonly revision: number; readonly count: number }
>();

function filledCellCount(store: Store): number {
  const sheetId = store.getActiveSheetId();
  const revision = store.revision;
  const cached = filledCountCache.get(store);
  if (cached !== undefined && cached.sheetId === sheetId && cached.revision === revision) return cached.count;
  // A sweep over the stored cells only: getCells() would build a "r,c" key for every one of them.
  let count = 0;
  const countFilled = (_r: number, _c: number, cell: Cell): void => { if (cell.text.length > 0) count += 1; };
  store.forEachCell(countFilled, sheetId);
  filledCountCache.set(store, { sheetId, revision, count });
  return count;
}

export const StatusBar: FC<StatusBarProps> = ({ store, selected, zoom, autoSaveStatus }) => {
  const filledCount = filledCellCount(store);

  const stats = selectionStats(store, selected);
  const filterCount = filterRecordCount(store);

  return (
    <div className="ss-status-bar" role="status" aria-label="Status bar">
      <span className="ss-status-item">单元格: {filledCount}</span>
      {filterCount !== null && (
        <>
          <span className="ss-status-divider">|</span>
          <span className="ss-status-item">找到 {filterCount.visible} 条记录（共 {filterCount.total} 条）</span>
        </>
      )}
      {stats !== null && (
        <>
          <span className="ss-status-divider">|</span>
          <span className="ss-status-item">求和: {stats.sum}</span>
          <span className="ss-status-item">平均: {stats.avg}</span>
          <span className="ss-status-item">计数: {stats.count}</span>
        </>
      )}
      <span className="ss-status-spacer" />
      {autoSaveStatus !== undefined && <span className="ss-status-item ss-status-save">{autoSaveStatus}</span>}
      <span className="ss-status-item">{zoom}%</span>
    </div>
  );
};

/** Memoized filter record count: like the stats below, only sheet content
 * changes can alter it, and those advance Store.revision. */
const filterCountCache = new WeakMap<
  Store,
  { readonly sheetId: string; readonly revision: number; readonly count: { readonly total: number; readonly visible: number } | null }
>();

function filterRecordCount(store: Store): { readonly total: number; readonly visible: number } | null {
  const sheetId = store.getActiveSheetId();
  const revision = store.revision;
  const cached = filterCountCache.get(store);
  if (cached !== undefined && cached.sheetId === sheetId && cached.revision === revision) return cached.count;
  const count = computeFilterCount(store);
  filterCountCache.set(store, { sheetId, revision, count });
  return count;
}

/** Excel shows "N of M records found" while AutoFilter criteria hide rows.
 * Rows are counted from the stored cells inside the filter range only; rows
 * without stored cells hold no record text and need no visit. */
function computeFilterCount(store: Store): { readonly total: number; readonly visible: number } | null {
  const filter = store.getAutoFilter();
  if (filter === undefined || Object.keys(filter.criteria).length === 0) return null;
  const { r1, c1, r2, c2 } = filter.range;
  const dataRows = new Set<number>();
  forEachStoredIn(store, { r1: r1 + 1, c1, r2, c2 }, (r, _c, cell) => {
    if (cell.text !== '') dataRows.add(r);
  });
  let visible = 0;
  for (const r of dataRows) {
    if (store.getRow(r)?.hide !== true) visible += 1;
  }
  return { total: dataRows.size, visible };
}

interface SelectionStats {
  readonly sum: number;
  readonly avg: string;
  readonly count: number;
}

/**
 * Call `fn(r, cell)` for the stored cells inside `rect`, at the cheaper of the
 * two possible costs: one hash lookup per address while the rect is smaller
 * than the sheet's stored population, otherwise a single sweep over the stored
 * cells filtered by the rect (a whole-column selection then costs what the
 * column holds, not its million-row address space).
 */
function forEachStoredIn(store: Store, rect: RangeAddress, fn: (r: number, c: number, cell: Cell) => void): void {
  const { r1, c1, r2, c2 } = rect;
  const area = (r2 - r1 + 1) * (c2 - c1 + 1);
  if (area < store.getCellCount()) {
    store.forEachCellInRect(rect, fn);
    return;
  }
  store.forEachCell((r, c, cell) => {
    if (r < r1 || r > r2 || c < c1 || c > c2) return;
    fn(r, c, cell);
  });
}

/** Memoized selection stats, keyed by (store, active sheet, revision, selection):
 * an unchanged selection on an unchanged sheet re-renders without rescanning. */
const selectionStatsCache = new WeakMap<
  Store,
  { readonly sheetId: string; readonly revision: number; readonly selected: string; readonly stats: SelectionStats | null }
>();

function selectionStats(store: Store, selected: RangeAddress | null): SelectionStats | null {
  const sheetId = store.getActiveSheetId();
  const revision = store.revision;
  const key = selected === null ? '' : `${selected.r1}:${selected.c1}:${selected.r2}:${selected.c2}`;
  const cached = selectionStatsCache.get(store);
  if (cached !== undefined && cached.sheetId === sheetId && cached.revision === revision && cached.selected === key) return cached.stats;
  const stats = computeSelectionStats(store, selected);
  selectionStatsCache.set(store, { sheetId, revision, selected: key, stats });
  return stats;
}

/** Sum/average/count of the numeric cells in the selection — stored cells of the used part of the selection only (see forEachStoredIn / Store.limitToData). */
function computeSelectionStats(store: Store, selected: RangeAddress | null): SelectionStats | null {
  if (selected === null) return null;
  const { r1, c1, r2, c2 } = selected;
  if (r1 === r2 && c1 === c2) return null;
  const rect = store.limitToData({ r1, c1, r2, c2 });

  let sum = 0;
  let count = 0;
  forEachStoredIn(store, rect, (_r, _c, cell) => {
    if (cell.text.length === 0) return;
    if (typeof cell.value === 'number') { sum += cell.value; count += 1; }
  });
  if (count === 0) return null;
  const avg = (sum / count).toFixed(2);
  return { sum, avg, count };
}
