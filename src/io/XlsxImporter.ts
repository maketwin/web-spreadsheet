import * as XLSX from 'xlsx';
import type { Cell } from '../types';

export interface SheetImport {
  readonly name: string;
  readonly cells: readonly (readonly Partial<Cell>[])[];
  /** Excel number format strings per cell (from the xlsx `z` field). */
  readonly numberFormats: readonly (readonly (string | undefined)[])[];
}

export interface ImportResult {
  readonly sheets: readonly SheetImport[];
}

export function importXlsx(buffer: ArrayBuffer): ImportResult {
  const wb = XLSX.read(buffer, { type: 'array', cellNF: true });
  const sheets: SheetImport[] = [];

  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (ws === undefined) continue;
    const aoa = XLSX.utils.sheet_to_json<(string | number | null | undefined)[]>(ws, { header: 1 });
    const cells = aoa.map((row) =>
      (row as (string | number | null | undefined)[]).map(cellFromValue)
    );
    const numberFormats = extractNumberFormats(ws, cells.length, cells[0]?.length ?? 0);
    sheets.push({ name, cells, numberFormats });
  }

  return { sheets };
}

function extractNumberFormats(ws: XLSX.WorkSheet, rows: number, cols: number): readonly (readonly (string | undefined)[])[] {
  const out: (string | undefined)[][] = [];
  for (let r = 0; r < rows; r += 1) {
    const row: (string | undefined)[] = [];
    for (let c = 0; c < cols; c += 1) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
      row.push(typeof cell?.z === 'string' ? cell.z : undefined);
    }
    out.push(row);
  }
  return out;
}

function cellFromValue(val: string | number | null | undefined): Partial<Cell> {
  if (val === null || val === undefined) return { text: '' };
  if (typeof val === 'number') return { text: String(val), value: val };
  return { text: String(val), value: val };
}
