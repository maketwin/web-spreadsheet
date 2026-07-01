import * as XLSX from 'xlsx';
import type { Cell } from '../types';

export interface SheetImport {
  readonly name: string;
  readonly cells: readonly (readonly Partial<Cell>[])[];
}

export interface ImportResult {
  readonly sheets: readonly SheetImport[];
}

export function importXlsx(buffer: ArrayBuffer): ImportResult {
  const wb = XLSX.read(buffer, { type: 'array' });
  const sheets: SheetImport[] = [];

  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (ws === undefined) continue;
    const aoa = XLSX.utils.sheet_to_json<(string | number | null | undefined)[]>(ws, { header: 1 });
    const cells = aoa.map((row) =>
      (row as (string | number | null | undefined)[]).map(cellFromValue)
    );
    sheets.push({ name, cells });
  }

  return { sheets };
}

function cellFromValue(val: string | number | null | undefined): Partial<Cell> {
  if (val === null || val === undefined) return { text: '' };
  if (typeof val === 'number') return { text: String(val), value: val };
  return { text: String(val), value: val };
}
