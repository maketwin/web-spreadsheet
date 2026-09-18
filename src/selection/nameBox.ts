import { NamedRangeService } from '../namedrange/NamedRangeService';
import { TOTAL_COLS, TOTAL_ROWS } from '../renderer/coordinate';
import { alpha2num } from '../util/alphabet';
import type { RangeAddress } from './Range';
import type { Store } from '../store/Store';

/** Where a name-box jump lands: a range plus the sheet it lives on (null = active). */
export interface NameBoxTarget {
  readonly sheetId: string | null;
  readonly range: RangeAddress;
}

const A1_RANGE = /^([A-Za-z]+[1-9]\d*)(?::([A-Za-z]+[1-9]\d*))?$/;
const SINGLE_A1 = /^([A-Za-z]+)([1-9]\d*)$/;
/** Excel 整列引用: "A" or "A:C". */
const COL_REF = /^([A-Za-z]{1,3})(?::([A-Za-z]{1,3}))?$/;
/** Excel 整行引用: "3" or "3:5". */
const ROW_REF = /^([1-9]\d*)(?::([1-9]\d*))?$/;

function exprToAddress(expr: string): { r: number; c: number } {
  const match = expr.match(SINGLE_A1);
  if (match === null) return { r: 0, c: 0 };
  return { r: Number(match[2]) - 1, c: alpha2num(match[1]!.toUpperCase()) };
}

function clampRange(range: RangeAddress): RangeAddress {
  return {
    r1: Math.max(0, Math.min(range.r1, TOTAL_ROWS - 1)),
    c1: Math.max(0, Math.min(range.c1, TOTAL_COLS - 1)),
    r2: Math.max(0, Math.min(range.r2, TOTAL_ROWS - 1)),
    c2: Math.max(0, Math.min(range.c2, TOTAL_COLS - 1)),
  };
}

/** Whole-column ref ("A", "C:A") or null. Columns beyond the grid clamp to the last column. */
function colRefRange(ref: string): RangeAddress | null {
  const m = ref.match(COL_REF);
  if (m === null) return null;
  const c1 = alpha2num(m[1]!.toUpperCase());
  const c2 = m[2] !== undefined ? alpha2num(m[2].toUpperCase()) : c1;
  if (c1 >= TOTAL_COLS && c2 >= TOTAL_COLS) return null; // beyond the grid, try a defined name instead
  return clampRange({ r1: 0, c1: Math.min(c1, c2), r2: TOTAL_ROWS - 1, c2: Math.max(c1, c2) });
}

/** Whole-row ref ("3", "5:3") or null. */
function rowRefRange(ref: string): RangeAddress | null {
  const m = ref.match(ROW_REF);
  if (m === null) return null;
  const r1 = Number(m[1]) - 1;
  const r2 = m[2] !== undefined ? Number(m[2]) - 1 : r1;
  if (r1 >= TOTAL_ROWS && r2 >= TOTAL_ROWS) return null;
  return clampRange({ r1: Math.min(r1, r2), c1: 0, r2: Math.max(r1, r2), c2: TOTAL_COLS - 1 });
}

/**
 * Excel name box: `A1`, `B2:D5` (either endpoint order), whole columns
 * (`A`, `A:C`), whole rows (`3`, `3:5`), `Sheet2!A1` or a defined name.
 * Returns null when the input resolves to nothing.
 */
export function parseNameBoxInput(store: Store, input: string): NameBoxTarget | null {
  const text = input.trim();
  if (text === '') return null;

  let sheetId: string | null = null;
  let ref = text;
  const bang = text.lastIndexOf('!');
  if (bang >= 0) {
    const sheet = store.getSheets().find((s) => s.name === text.slice(0, bang));
    if (sheet === undefined) return null;
    sheetId = sheet.id;
    ref = text.slice(bang + 1);
  }

  const a1 = ref.match(A1_RANGE);
  if (a1 !== null) {
    const start = exprToAddress(a1[1]!);
    const end = a1[2] !== undefined ? exprToAddress(a1[2]) : start;
    return { sheetId, range: clampRange({ r1: Math.min(start.r, end.r), c1: Math.min(start.c, end.c), r2: Math.max(start.r, end.r), c2: Math.max(start.c, end.c) }) };
  }

  // Excel resolves column/row refs before defined names (a name shadowing "A" loses).
  const col = colRefRange(ref);
  if (col !== null) return { sheetId, range: col };
  const row = rowRefRange(ref);
  if (row !== null) return { sheetId, range: row };

  if (bang >= 0) return null; // refs after "Sheet!" must parse; names carry no sheet prefix
  const def = new NamedRangeService().lookup(store, text);
  if (def === undefined) return null;
  const coords = def.range.split(':');
  const start = coords[0]?.split(',').map(Number);
  const end = coords[1]?.split(',').map(Number) ?? start;
  if (start === undefined || start.length < 2) return null;
  const range = { r1: start[0] ?? 0, c1: start[1] ?? 0, r2: end?.[0] ?? (start[0] ?? 0), c2: end?.[1] ?? (start[1] ?? 0) };
  return { sheetId: def.sheetId ?? null, range: clampRange(range) };
}
