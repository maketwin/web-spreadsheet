import type { Store } from '../store/Store';
import type { Cell, CellValue } from '../types';
import { displayTextOf } from '../format/displayText';
import { MAX_DENSE_RANGE_CELLS } from '../util/limits';

/** A package refused because its used-range rectangle is beyond a dense CSV walk; the message is shown to the user as is. */
export class CsvRangeTooLargeError extends Error {
  public constructor() {
    super('已用区域过大，无法导出为 CSV；请删除远处孤立的单元格后重试');
    this.name = 'CsvRangeTooLargeError';
  }
}

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
 * The style is the effective one (cell > row > column, Store.getCellStyle), so
 * a column default format formats the cells sitting under it.
 */
function cellText(store: Store, r: number, c: number, cell: Cell | undefined): string {
  if (cell === undefined) return '';
  const text = displayTextOf(cell, store.getCellStyle(r, c, cell));
  if (text !== '') return text;
  if (typeof cell.value === 'boolean') return cell.value ? 'TRUE' : 'FALSE';
  return text;
}

/**
 * Active-sheet CSV: the used-range rectangle (dense rows × cols) as displayed
 * values, so formula cells export their result like Excel's CSV export.
 * Stored cells are bucketed per row first — the walk tracks what exists, and
 * the rectangle it spans is emitted as text rows, never materialised as a grid.
 */
export function exportCsv(store: Store): string {
  const stored = new Map<number, Map<number, Cell>>();
  let maxR = -1;
  let maxC = -1;

  store.forEachCell((r, c, cell) => {
    if (r < 0 || c < 0) return; // never a stored coordinate; defensive only
    if (cellText(store, r, c, cell) === '') return;
    let row = stored.get(r);
    if (row === undefined) {
      row = new Map();
      stored.set(r, row);
    }
    row.set(c, cell);
    if (r > maxR) maxR = r;
    if (c > maxC) maxC = c;
  });

  // The loops below are dense over the used rectangle, so their area is
  // bounded: two far-apart cells would otherwise turn one export into a
  // walk over billions of empty addresses.
  if ((maxR + 1) * (maxC + 1) > MAX_DENSE_RANGE_CELLS) throw new CsvRangeTooLargeError();
  const rows: string[] = [];
  for (let r = 0; r <= maxR; r += 1) {
    const row = stored.get(r);
    const fields: string[] = [];
    for (let c = 0; c <= maxC; c += 1) {
      const cell = row?.get(c);
      fields.push(csvQuote(cellText(store, r, c, cell), cell?.value));
    }
    rows.push(fields.join(','));
  }
  return rows.join('\r\n');
}

/** CSV blob with a UTF-8 BOM so Excel opens CJK content correctly. */
export function exportCsvBlob(store: Store): Blob {
  return new Blob([`﻿${exportCsv(store)}`], { type: 'text/csv;charset=utf-8' });
}
