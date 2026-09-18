import * as XLSX from 'xlsx';
import { TOTAL_COLS, TOTAL_ROWS } from '../renderer/coordinate';
import type { Store } from '../store/Store';
import type { Cell } from '../types';
import { parseRange } from '../util/cell';
import { appendChartsToXlsx } from './chartXmlExport';
import { appendStylesToXlsx } from './styleXmlExport';

export function exportXlsxBuffer(store: Store): ArrayBuffer {
  const wb = XLSX.utils.book_new();

  for (const { id, name } of store.getSheets()) {
    const sheetData = store.getSheetData(id);
    if (sheetData === undefined) continue;

    const cells = sheetData.getCells();
    const aoa = buildAoa(cells);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    applyNumberFormats(ws, cells, store, id);
    applyFormulas(ws, cells);
    applyMerges(ws, store.getMerges(id));
    XLSX.utils.book_append_sheet(wb, ws, name);
  }

  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  const sheetIds = store.getSheets().map(({ id }) => id);
  // SheetJS writes no cell styles: fonts/fills/alignment/numFmt xfs and rich
  // runs ride in via zip post-processing, then chart parts are appended.
  return appendChartsToXlsx(appendStylesToXlsx(buf, store, sheetIds), store, sheetIds);
}

export function exportXlsx(store: Store): Blob {
  const buf = exportXlsxBuffer(store);
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/** Formula cells export the formula itself (Excel recalculates on open); the cached value rides along. */
function applyFormulas(ws: XLSX.WorkSheet, cells: readonly [string, Cell][]): void {
  for (const [key, cell] of cells) {
    if (cell.formula === undefined) continue;
    const [r, c] = key.split(',').map(Number);
    const addr = XLSX.utils.encode_cell({ r: r ?? 0, c: c ?? 0 });
    const existing = ws[addr] as XLSX.CellObject | undefined;
    if (existing === undefined) continue;
    existing.f = cell.formula.replace(/^=/, '');
  }
}

/** Merged cells round-trip through the worksheet `!merges` list. */
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

/** Write each styled cell's number format into the xlsx cell `z` field. */
function applyNumberFormats(ws: XLSX.WorkSheet, cells: readonly [string, Cell][], store: Store, sheetId: string): void {
  for (const [key, cell] of cells) {
    if (cell.styleId === undefined) continue;
    const nf = store.getStyle(cell.styleId, sheetId)?.numberFormat;
    if (nf === undefined || nf === 'general') continue;
    const [r, c] = key.split(',').map(Number);
    const addr = XLSX.utils.encode_cell({ r: r ?? 0, c: c ?? 0 });
    const existing = ws[addr] as XLSX.CellObject | undefined;
    if (existing === undefined) continue;
    existing.z = BUILT_IN_NUMFMT[nf] ?? nf;
  }
}

function buildAoa(cells: readonly [string, Cell][]): (string | number | boolean | null)[][] {
  let maxR = 0;
  let maxC = 0;
  const cellMap = new Map<string, Cell>();

  for (const [key, cell] of cells) {
    const parts = key.split(',');
    const r = Number(parts[0]);
    const c = Number(parts[1]);
    // Bounded by the fixed grid: a stray far-away key can never turn the
    // dense export loop into a multi-billion-iteration walk.
    if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || r >= TOTAL_ROWS || c < 0 || c >= TOTAL_COLS) continue;
    if (r > maxR) maxR = r;
    if (c > maxC) maxC = c;
    cellMap.set(key, cell);
  }

  const rows: (string | number | boolean | null)[][] = [];
  for (let r = 0; r <= maxR; r += 1) {
    const row: (string | number | boolean | null)[] = [];
    for (let c = 0; c <= maxC; c += 1) {
      const cell = cellMap.get(`${r},${c}`);
      if (cell === undefined) {
        row.push(null);
      } else if (typeof cell.value === 'number') {
        row.push(cell.value);
      } else if (typeof cell.value === 'boolean') {
        row.push(cell.value);
      } else {
        row.push(cell.text);
      }
    }
    rows.push(row);
  }
  return rows;
}
