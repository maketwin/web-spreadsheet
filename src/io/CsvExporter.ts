import { TOTAL_COLS, TOTAL_ROWS } from '../renderer/coordinate';
import type { Store } from '../store/Store';
import type { Cell } from '../types';
import { displayTextOf } from '../util/cell';

/** RFC 4180: quote a field containing the separator, a quote, CR or LF; double embedded quotes. */
export function csvQuote(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/**
 * Displayed-value text of a cell, matching Excel's CSV export (所见即所得):
 * number formats apply (e.g. `#,##0.00` → `1,234.50`), booleans are TRUE/FALSE.
 */
function cellText(store: Store, cell: Cell | undefined): string {
  if (cell === undefined) return '';
  const style = cell.styleId !== undefined ? store.getStyle(cell.styleId) : undefined;
  const text = displayTextOf(cell, style);
  if (text !== '') return text;
  if (typeof cell.value === 'boolean') return cell.value ? 'TRUE' : 'FALSE';
  return text;
}

/**
 * Active-sheet CSV: the used-range rectangle (dense rows × cols) as displayed
 * values, so formula cells export their result like Excel's CSV export.
 */
export function exportCsv(store: Store): string {
  let maxR = -1;
  let maxC = -1;
  const cellMap = new Map<string, Cell>();

  for (const [key, cell] of store.getCells()) {
    const parts = key.split(',');
    const r = Number(parts[0]);
    const c = Number(parts[1]);
    // Bounded by the fixed grid — a stray far-away key can never blow up the dense loop.
    if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || r >= TOTAL_ROWS || c < 0 || c >= TOTAL_COLS) continue;
    if (cellText(store, cell) === '') continue;
    cellMap.set(key, cell);
    if (r > maxR) maxR = r;
    if (c > maxC) maxC = c;
  }

  const rows: string[] = [];
  for (let r = 0; r <= maxR; r += 1) {
    const fields: string[] = [];
    for (let c = 0; c <= maxC; c += 1) fields.push(csvQuote(cellText(store, cellMap.get(`${r},${c}`))));
    rows.push(fields.join(','));
  }
  return rows.join('\r\n');
}

/** CSV blob with a UTF-8 BOM so Excel opens CJK content correctly. */
export function exportCsvBlob(store: Store): Blob {
  return new Blob([`﻿${exportCsv(store)}`], { type: 'text/csv;charset=utf-8' });
}
