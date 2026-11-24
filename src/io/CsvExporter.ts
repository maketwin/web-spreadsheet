import { TOTAL_COLS, TOTAL_ROWS } from '../renderer/coordinate';
import type { Store } from '../store/Store';
import type { Cell, CellValue } from '../types';
import { displayTextOf } from '../util/cell';

/**
 * RFC 4180: quote a field containing the separator, a quote, CR or LF;
 * double embedded quotes. `typed` is the value the cell holds (its text is
 * only how it is displayed), which decides the formula-injection guard.
 */
export function csvQuote(value: string, typed: CellValue | undefined = undefined): string {
  // Excel treats a leading = + - @ as a formula when it opens a CSV.
  const guarded = formulaInjectionPrefix(value, typed) + value;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replaceAll('"', '""')}"` : guarded;
}

/** `-1,234.50`, `- 1,234.50`, `-$1,234.50`, `-12.5%`, `-1.2E+05`: digits with display decoration only — no operator, no reference. */
const NEGATIVE_NUMBER = /^-\s*\p{Sc}?\s*\d{1,3}(,\d{3})*(\.\d+)?%?$/u;
const NEGATIVE_PLAIN_NUMBER = /^-\s*\p{Sc}?\s*\d+(\.\d+)?([eE][+-]?\d+)?%?$/u;

function formulaInjectionPrefix(value: string, typed: CellValue | undefined): string {
  if (value.length === 0) return '';
  // A cell that holds a number or a boolean only *displays* those leading
  // characters ("-1,234.50", "-12.50%"): Excel reads the field back as that
  // number, and a `'` would turn it into text.
  if (typeof typed === 'number' || typeof typed === 'boolean' || typed instanceof Date) return '';
  const head = value[0];
  if (head === '=' || head === '+' || head === '@' || head === '\t' || head === '\r') return "'";
  if (head === '-' && !NEGATIVE_NUMBER.test(value) && !NEGATIVE_PLAIN_NUMBER.test(value)) return "'";
  return '';
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
    for (let c = 0; c <= maxC; c += 1) {
      const cell = cellMap.get(`${r},${c}`);
      fields.push(csvQuote(cellText(store, cell), cell?.value));
    }
    rows.push(fields.join(','));
  }
  return rows.join('\r\n');
}

/** CSV blob with a UTF-8 BOM so Excel opens CJK content correctly. */
export function exportCsvBlob(store: Store): Blob {
  return new Blob([`﻿${exportCsv(store)}`], { type: 'text/csv;charset=utf-8' });
}
