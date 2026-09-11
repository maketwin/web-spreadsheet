import * as XLSX from 'xlsx';
import type { Store } from '../store/Store';
import type { Cell } from '../types';

export function exportXlsxBuffer(store: Store): ArrayBuffer {
  const wb = XLSX.utils.book_new();

  for (const { id, name } of store.getSheets()) {
    const sheetData = store.getSheetData(id);
    if (sheetData === undefined) continue;

    const cells = sheetData.getCells();
    const aoa = buildAoa(cells);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    applyNumberFormats(ws, cells, store, id);
    XLSX.utils.book_append_sheet(wb, ws, name);
  }

  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

export function exportXlsx(store: Store): Blob {
  const buf = exportXlsxBuffer(store);
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
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

function buildAoa(cells: readonly [string, Cell][]): (string | number | null)[][] {
  let maxR = 0;
  let maxC = 0;
  const cellMap = new Map<string, Cell>();

  for (const [key, cell] of cells) {
    const parts = key.split(',');
    const r = Number(parts[0]);
    const c = Number(parts[1]);
    if (r > maxR) maxR = r;
    if (c > maxC) maxC = c;
    cellMap.set(key, cell);
  }

  const rows: (string | number | null)[][] = [];
  for (let r = 0; r <= maxR; r += 1) {
    const row: (string | number | null)[] = [];
    for (let c = 0; c <= maxC; c += 1) {
      const cell = cellMap.get(`${r},${c}`);
      if (cell === undefined) {
        row.push(null);
      } else if (typeof cell.value === 'number') {
        row.push(cell.value);
      } else {
        row.push(cell.text);
      }
    }
    rows.push(row);
  }
  return rows;
}
