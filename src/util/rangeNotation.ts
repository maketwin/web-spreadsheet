import { alpha2num } from './alphabet';
import { TOTAL_COLS, TOTAL_ROWS } from './gridSize';

/**
 * The model's two range notations, parsed and converted here so this module
 * stays a leaf of the graph (depends only on util/alphabet and util/gridSize):
 * - A1 notation (`"B2:D4"`): stored merges and other user-facing ranges
 *   ({@link parseRange}).
 * - Internal notation (`"r1,c1[:r2,c2]"`): named ranges, conditional-format
 *   and validation ranges, charts, sparklines, autofilter
 *   ({@link parseInternalRange}, {@link shiftInternalRange}).
 */

export interface CellAddress {
  readonly r: number;
  readonly c: number;
}

/** Parse a bare `A1` coordinate; unparsable input yields `{ r: 0, c: 0 }`. */
export function exprToCoords(expr: string): CellAddress {
  const match = expr.match(/^([A-Za-z]+)([1-9]\d*)$/);
  const col = match?.[1];
  const row = match?.[2];
  if (col === undefined || row === undefined) return { r: 0, c: 0 };
  return { r: Number(row) - 1, c: alpha2num(col.toUpperCase()) };
}

/** Map one 0-based index through an insert/delete; negative means deleted (#REF!). */
export function shiftAxis(index: number, start: number, count: number): number {
  if (count > 0) return index >= start ? index + count : index;
  const deleted = -count;
  if (index >= start + deleted) return index - deleted;
  if (index >= start) return -1;
  return index;
}

/** Map a range's endpoints; a range fully inside the deleted zone dies. */
export function shiftRangeAxis(a: number, b: number, start: number, count: number): readonly [number, number] | '#REF!' {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  if (count < 0 && lo >= start && hi < start - count) return '#REF!';
  const map = (index: number): number => {
    if (count > 0) return index >= start ? index + count : index;
    const deleted = -count;
    if (index >= start + deleted) return index - deleted;
    if (index >= start) return start; // deleted endpoint collapses into the zone
    return index;
  };
  return [map(lo), map(hi)];
}

/**
 * Shift an internal "r1,c1[:r2,c2]" range (named ranges, conditional-format
 * and validation ranges, autofilter) with the same semantics as
 * {@link shiftRangeAxis}: inserts grow, deletes shrink, a fully deleted
 * range returns null. Unparsable input is returned unchanged.
 */
export function shiftInternalRange(range: string, axis: 'row' | 'col', start: number, count: number): string | null {
  const parsed = parseInternalRange(range);
  if (parsed === null) return range;
  const shifted = shiftRangeAxis(axis === 'row' ? parsed.r1 : parsed.c1, axis === 'row' ? parsed.r2 : parsed.c2, start, count);
  if (shifted === '#REF!') return null;
  const max = axis === 'row' ? TOTAL_ROWS - 1 : TOTAL_COLS - 1;
  const [lo, hi] = shifted;
  const clamped = (v: number): number => Math.min(v, max);
  const first = axis === 'row' ? `${clamped(lo)},${parsed.c1}` : `${parsed.r1},${clamped(lo)}`;
  if (!range.includes(':')) return first;
  const second = axis === 'row' ? `${clamped(hi)},${parsed.c2}` : `${parsed.r2},${clamped(hi)}`;
  return `${first}:${second}`;
}

export interface InternalRange {
  readonly r1: number;
  readonly c1: number;
  readonly r2: number;
  readonly c2: number;
}

const INT_COORD = /^-?\d+$/;

/** One "r,c" corner: exactly two decimal integer coordinates, no whitespace. */
function parseInternalCorner(part: string): { readonly r: number; readonly c: number } | null {
  const coords = part.split(',');
  const rText = coords[0];
  const cText = coords[1];
  if (coords.length !== 2 || rText === undefined || cText === undefined) return null;
  if (!INT_COORD.test(rText) || !INT_COORD.test(cText)) return null;
  const r = Number(rText);
  const c = Number(cText);
  if (!Number.isFinite(r) || !Number.isFinite(c)) return null; // digit storms overflow to Infinity
  return { r, c };
}

/**
 * "r,c" or "r1,c1:r2,c2": a single cell doubles as its own end; corners are
 * normalised (r1 ≤ r2, c1 ≤ c2). null for anything else.
 *
 * The one parser for the internal notation used by conditional-format,
 * validation and named-range keys, chart/sparkline specs and autofilter.
 * Coordinates are finite decimal integer literals (a leading `-` is fine);
 * whitespace, floats, extra coordinates, extra `:` segments or empty parts
 * all yield null.
 */
export function parseInternalRange(key: string): InternalRange | null {
  const parts = key.split(':');
  if (parts.length > 2) return null;
  const head = parseInternalCorner(parts[0] ?? '');
  if (head === null) return null;
  const tail = parts[1] !== undefined ? parseInternalCorner(parts[1]) : head;
  if (tail === null) return null;
  return {
    r1: Math.min(head.r, tail.r),
    c1: Math.min(head.c, tail.c),
    r2: Math.max(head.r, tail.r),
    c2: Math.max(head.c, tail.c),
  };
}

export function parseRange(rangeStr: string): { r1: number; c1: number; r2: number; c2: number } {
  const parts = rangeStr.split(':');
  const start = exprToCoords(parts[0] ?? rangeStr);
  const end = parts[1] !== undefined ? exprToCoords(parts[1]) : start;
  return { r1: Math.min(start.r, end.r), c1: Math.min(start.c, end.c), r2: Math.max(start.r, end.r), c2: Math.max(start.c, end.c) };
}
