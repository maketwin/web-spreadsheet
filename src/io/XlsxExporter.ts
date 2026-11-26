import * as XLSX from 'xlsx';
import { unzipSync, zipSync } from 'fflate';
import { TOTAL_COLS, TOTAL_ROWS } from '../util/gridSize';
import { MAX_DENSE_EXPORT_EMPTY_CELLS } from '../util/limits';
import type { Store } from '../store/Store';
import type { Cell } from '../types';
import { parseRange } from '../util/rangeNotation';
import { applyChartsToXlsx } from './chartXmlExport';
import { applyCommentsToXlsx } from './commentXmlExport';
import { applySheetFeaturesToXlsx } from './sheetXmlExport';
import { applyStylesToXlsx } from './styleXmlExport';
import { restorePackedSheets, type SheetPackPlan } from './sheetPackingExport';

/** One stored cell with its coordinates, in `forEachCell` order until packing sorts them. */
interface SheetEntry {
  readonly r: number;
  readonly c: number;
  readonly cell: Cell;
}

export function exportXlsxBuffer(store: Store): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  const packs = new Map<number, SheetPackPlan>();

  for (const [index, { id, name }] of store.getSheets().entries()) {
    const sheetData = store.getSheetData(id);
    if (sheetData === undefined) continue;
    const entries = collectEntries(store, id);
    const { ws, pack } = buildSheet(store, id, entries, store.getUsedBounds(id));
    applyMerges(ws, store.getMerges(id));
    if (pack !== undefined) packs.set(index, pack);
    XLSX.utils.book_append_sheet(wb, ws, name);
  }

  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  // All post-processing happens on one in-memory file table: the package is
  // this export's own output, so the import-side zip limits do not apply —
  // filtering a part out here would silently drop it from the finished file.
  // Packed sheets are restored first so every later processor matches on real
  // coordinates; then SheetJS writes no cell styles, so fonts/fills/alignment/
  // numFmt xfs and rich runs ride in via the styles pass, freeze panes /
  // autofilter / conditional formats / validations are merged into the sheet
  // parts in schema order, and chart and comment parts are appended last.
  // One compressed re-zip at the end (SheetJS's own zip is uncompressed).
  const files = unzipSync(new Uint8Array(buf));
  if (packs.size > 0) restorePackedSheets(files, packs);
  const sheetIds = store.getSheets().map(({ id }) => id);
  applyStylesToXlsx(files, store, sheetIds);
  applySheetFeaturesToXlsx(files, store, sheetIds);
  applyChartsToXlsx(files, store, sheetIds);
  applyCommentsToXlsx(files, store, sheetIds);
  const zipped = zipSync(files);
  return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
}

export function exportXlsx(store: Store): Blob {
  const buf = exportXlsxBuffer(store);
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/** One sparse pass over the sheet's stored cells — the walk never touches the address space. */
function collectEntries(store: Store, sheetId: string): SheetEntry[] {
  const out: SheetEntry[] = [];
  store.forEachCell((r, c, cell) => {
    // Defensive: a beyond-space coordinate (never written by the app) stays
    // out of the package instead of corrupting it.
    if (r < 0 || c < 0 || r >= TOTAL_ROWS || c >= TOTAL_COLS) return;
    out.push({ r, c, cell });
  }, sheetId);
  return out;
}

/** Same value mapping the dense AOA build used: numbers and booleans keep their typed value, everything else exports as its displayed text. */
function toSheetCell(cell: Cell): XLSX.CellObject {
  const value = typeof cell.value === 'number' || typeof cell.value === 'boolean' ? cell.value : cell.text;
  return typeof value === 'number'
    ? { t: 'n', v: value }
    : typeof value === 'boolean'
      ? { t: 'b', v: value }
      : { t: 's', v: value };
}

/**
 * Sparse worksheet build: one SheetJS cell per stored cell, no dense
 * array-of-arrays in between — the address space is never walked, so a
 * workbook whose only cell sits at XFD1048576 costs the same as one at A1.
 *
 * The writer's cost only multiplies when stored cells sit far apart inside a
 * huge `!ref` rectangle (it touches every address). Past
 * MAX_DENSE_EXPORT_EMPTY_CELLS empty addresses the cells are therefore
 * packed into a dense block, cell k at `(floor(k / width), k % width)`; the
 * returned plan restores their real coordinates in the written XML, so the
 * finished part is identical to the plain path apart from the transient
 * addresses. Merges below stay at real coordinates — they do not participate
 * in the walk.
 */
function buildSheet(
  store: Store,
  sheetId: string,
  entries: readonly SheetEntry[],
  bounds: { readonly r1: number; readonly c1: number; readonly r2: number; readonly c2: number } | undefined,
): { ws: XLSX.WorkSheet; pack: SheetPackPlan | undefined } {
  const ws: XLSX.WorkSheet = {};
  if (bounds === undefined || entries.length === 0) {
    ws['!ref'] = 'A1:A1';
    return { ws, pack: undefined };
  }
  // At most 1.7e10 for the whole grid — exact in a double, no overflow surprises.
  const area = (bounds.r2 - bounds.r1 + 1) * (bounds.c2 - bounds.c1 + 1);
  const packed = area - entries.length > MAX_DENSE_EXPORT_EMPTY_CELLS;
  const ordered = packed ? [...entries].sort((a, b) => a.r - b.r || a.c - b.c) : entries;
  // Square-ish packing so the walk is exactly one address per stored cell.
  const width = packed ? Math.min(TOTAL_COLS, Math.max(1, Math.ceil(Math.sqrt(ordered.length)))) : 0;
  const realKeys: number[] = [];

  for (let k = 0; k < ordered.length; k += 1) {
    const { r, c, cell } = ordered[k]!;
    const sheetCell = toSheetCell(cell);
    // Number format / formula / hyperlink ride on the same object — the
    // three passes they used to get collapse into this one.
    if (cell.styleId !== undefined) {
      const nf = store.getStyle(cell.styleId, sheetId)?.numberFormat;
      if (nf !== undefined && nf !== 'general') sheetCell.z = BUILT_IN_NUMFMT[nf] ?? nf;
    }
    if (cell.formula !== undefined) sheetCell.f = cell.formula.replace(/^=/, '');
    if (cell.hyperlink !== undefined) {
      const link: { Target: string; Tooltip?: string } = { Target: cell.hyperlink.target };
      if (cell.hyperlink.tooltip !== undefined) link.Tooltip = cell.hyperlink.tooltip;
      (sheetCell as XLSX.CellObject & { l?: { Target: string; Tooltip?: string } }).l = link;
    }
    ws[XLSX.utils.encode_cell(packed ? { r: Math.floor(k / width), c: k % width } : { r, c })] = sheetCell;
    if (packed) realKeys.push(r * TOTAL_COLS + c);
  }

  ws['!ref'] = packed
    ? XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.ceil(ordered.length / width) - 1, c: width - 1 } })
    // Tight extent from the store's used bounds: SheetJS's writer walks the
    // `!ref` rectangle, so a spread-out sheet must not get a padding-to-A1
    // dimension — an A1 + A1048576 workbook would turn into a million-step walk.
    : XLSX.utils.encode_range({ s: { r: bounds.r1, c: bounds.c1 }, e: { r: bounds.r2, c: bounds.c2 } });
  return { ws, pack: packed ? { width, realKeys, bounds: { ...bounds } } : undefined };
}

/** Merged cells round-trip through the worksheet `!merges` list (real coordinates). */
function applyMerges(ws: XLSX.WorkSheet, merges: readonly string[]): void {
  if (merges.length === 0) return;
  ws['!merges'] = merges.map((m) => {
    const a = parseRange(m);
    return { s: { r: a.r1, c: a.c1 }, e: { r: a.r2, c: a.c2 } };
  });
}

const BUILT_IN_NUMFMT: Readonly<Record<string, string>> = {
  number: '#,##0.00',
  currency: '¥#,##0.00',
  percent: '0.00%',
  date: 'yyyy-mm-dd',
  time: 'hh:mm:ss',
  scientific: '0.00E+00',
};
