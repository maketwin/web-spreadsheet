/** Print pagination: used-range detection and page-band splitting (pure geometry).
 *
 * Pages are split independently per axis: column bands must fit the content
 * width, row bands the content height (both after applying the print scale).
 * Band boundaries never cut through a merged cell when the merge fits on a
 * page of its own; a merge wider/taller than a page is cut (Excel behavior).
 */
import { COL_WIDTH, ROW_HEIGHT } from '../renderer/coordinate';
import type { Store } from '../store/Store';
import { cellIdCoords, parseRange } from '../util/cell';
import { contentPx, footerBandPx, headerBandPx, type PrintSettings } from './types';

export interface UsedRange { readonly r1: number; readonly c1: number; readonly r2: number; readonly c2: number }

export interface AxisBand { readonly start: number; readonly end: number }

export interface PageLayout {
  readonly index: number;
  readonly colStart: number;
  readonly colEnd: number;
  readonly rowStart: number;
  readonly rowEnd: number;
}

export interface PrintGeometry {
  readonly used: UsedRange;
  /** Grid-px → CSS-px factor applied to every painted page. */
  readonly scale: number;
  readonly colBands: readonly AxisBand[];
  readonly rowBands: readonly AxisBand[];
  /** Cartesian product, Excel page order: down the rows first, then across. */
  readonly pages: readonly PageLayout[];
}

const MIN_SCALE = 0.25;
const MAX_SCALE = 3;
/** Tolerance so a band whose scaled width lands within half a px still fits. */
const FIT_EPSILON = 0.5;

/** Bottom-right of the sheet's used range (cells, styles, merges). Empty sheet → A1. */
export function usedRange(store: Store, sheetId = store.getActiveSheetId()): UsedRange {
  let maxR = 0;
  let maxC = 0;
  for (const [key, cell] of store.getCells(sheetId)) {
    const empty = cell.text.length === 0 && cell.formula === undefined && cell.styleId === undefined;
    if (empty) continue;
    const coords = cellIdCoords(key);
    if (coords === null) continue;
    if (coords.r > maxR) maxR = coords.r;
    if (coords.c > maxC) maxC = coords.c;
  }
  for (const merge of store.getMerges(sheetId)) {
    const { r2, c2 } = parseRange(merge);
    if (r2 > maxR) maxR = r2;
    if (c2 > maxC) maxC = c2;
  }
  return { r1: 0, c1: 0, r2: maxR, c2: maxC };
}

export function paginate(store: Store, sheetId: string, used: UsedRange, settings: PrintSettings): PrintGeometry {
  const content = contentPx(settings);
  // Header/footer bands shrink the row budget (they overlay top/bottom bands).
  const rowBudget = Math.max(20, content.h - headerBandPx(settings) - footerBandPx(settings));
  const colWidth = (c: number): number => {
    const meta = store.getCol(c, sheetId);
    return meta !== undefined && meta.hide === true ? 0 : meta?.width ?? COL_WIDTH;
  };
  const rowHeight = (r: number): number => {
    const meta = store.getRow(r, sheetId);
    return meta !== undefined && meta.hide === true ? 0 : meta?.height ?? ROW_HEIGHT;
  };
  const merges = store.getMerges(sheetId).map(parseRange);

  let totalW = 0;
  for (let c = used.c1; c <= used.c2; c += 1) totalW += colWidth(c);
  const scale = settings.scaleMode === 'fitWidth'
    ? clampScale(totalW <= 0 ? 1 : content.w / totalW)
    : clampScale(settings.scalePercent / 100);

  const colBands = axisBands(
    (c) => colWidth(c) * scale,
    used.c1, used.c2, content.w,
    merges.map((m) => ({ start: m.c1, end: m.c2 })),
  );
  const rowBands = axisBands(
    (r) => rowHeight(r) * scale,
    used.r1, used.r2, rowBudget,
    merges.map((m) => ({ start: m.r1, end: m.r2 })),
  );

  const pages: PageLayout[] = [];
  let index = 0;
  for (const col of colBands) {
    for (const row of rowBands) {
      pages.push({ index, colStart: col.start, colEnd: col.end, rowStart: row.start, rowEnd: row.end });
      index += 1;
    }
  }
  return { used, scale, colBands, rowBands, pages };
}

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/** Split [from, to] into bands whose accumulated sizes fit `budget`.
 * Each band keeps at least one index (oversized items get a page of their own). */
function axisBands(sizeAt: (i: number) => number, from: number, to: number, budget: number, mergeBlocks: readonly { start: number; end: number }[]): AxisBand[] {
  const prefix = new Array<number>(to - from + 2);
  prefix[0] = 0;
  for (let i = from; i <= to; i += 1) prefix[i - from + 1] = (prefix[i - from] ?? 0) + Math.max(0, sizeAt(i));
  const sum = (a: number, b: number): number => (prefix[b - from + 1] ?? 0) - (prefix[a - from] ?? 0);

  const bands: AxisBand[] = [];
  let bandStart = from;
  for (let i = from; i <= to; i += 1) {
    if (i > bandStart && sum(bandStart, i) > budget + FIT_EPSILON) {
      // Item i does not fit: cut before it, unless that would slice a merge.
      const crossing = mergeBlocks.find((m) => m.start <= i - 1 && m.end >= i);
      let cut = i - 1;
      if (crossing !== undefined) {
        if (crossing.start > bandStart) cut = crossing.start - 1;
        else cut = Math.min(crossing.end, to);
      }
      bands.push({ start: bandStart, end: cut });
      bandStart = cut + 1;
    }
  }
  if (bandStart <= to) bands.push({ start: bandStart, end: to });
  else if (bands.length === 0) bands.push({ start: from, end: Math.max(from, to) });
  return bands;
}
