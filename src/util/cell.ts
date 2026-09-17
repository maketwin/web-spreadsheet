import type { Cell, CellValue, Style } from '../types';
import { formatValue } from '../format/NumberFormatter';
import { TOTAL_COLS, TOTAL_ROWS } from '../renderer/coordinate';
import { alpha2num, num2alpha } from './alphabet';

export interface CellAddress {
  readonly r: number;
  readonly c: number;
}

export type CellInput = string | Partial<Cell>;

export function normalizeCellInput(cell: CellInput): Cell {
  if (typeof cell === 'string') return cellFromText(undefined, cell);

  const text = cell.text ?? cell.formula ?? '';
  const next: Cell = { ...cell, text };
  const formula = formulaText(next);
  if (formula !== undefined) {
    delete next.value;
    next.formula = formula;
    return next;
  }

  delete next.formula;
  const value = valueFromText(text);
  if (value !== undefined) next.value = value;
  return next;
}

export function cellFromText(oldCell: Cell | undefined, text: string): Cell {
  const next: Cell = oldCell === undefined ? { text } : { ...oldCell, text };
  delete next.formula;
  delete next.value;

  const formula = formulaText(next);
  if (formula !== undefined) {
    next.formula = formula;
    return next;
  }

  const value = valueFromText(text);
  if (value !== undefined) next.value = value;
  return next;
}

export function valueFromText(text: string): CellValue | undefined {
  if (text.trim() === '' || text.startsWith('=')) return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}

export function formulaText(cell: Cell | undefined): string | undefined {
  if (cell?.formula !== undefined) return cell.formula;
  return cell?.text.startsWith('=') === true ? cell.text : undefined;
}

export function cellId(r: number, c: number): string {
  return `${r},${c}`;
}

/** Inverse of {@link cellId}: parse "r,c" back to coordinates; null when malformed. */
export function cellIdCoords(id: string): { r: number; c: number } | null {
  const sep = id.indexOf(',');
  if (sep <= 0) return null;
  const r = Number(id.slice(0, sep));
  const c = Number(id.slice(sep + 1));
  if (!Number.isFinite(r) || !Number.isFinite(c)) return null;
  return { r, c };
}

/**
 * The value a cell shows on screen: number-formatted text when a
 * non-general numberFormat applies, otherwise the raw text. Excel's filter
 * UI operates on this display value, not the underlying input.
 */
export function displayTextOf(cell: Cell | undefined, style: Style | undefined): string {
  if (cell === undefined) return '';
  const nf = style?.numberFormat;
  if (nf !== undefined && nf !== 'general') {
    const result = formatValue(cell.value, nf);
    if (result.formatted) return result.text;
  }
  return cell.text;
}

const REF_OR_RANGE_TOKEN = /\$?[A-Za-z]{1,3}\$?[1-9]\d*(?::\$?[A-Za-z]{1,3}\$?[1-9]\d*)?(?![\w(])/g;

/**
 * Rewrite same-sheet A1 references pointing inside the sorted range through
 * the row permutation so moved formulas keep referencing the same logical
 * cells. For a range, every row between the endpoints is mapped (not just
 * the two corners) — endpoint-only remapping shrinks ranges when an interior
 * row sorts outside the new corner span (common when AutoFilter is on and
 * the user sorts by a formula/total column). Rows absent from the permutation
 * (hidden/pinned under a filter) keep their index. Corners are re-normalized
 * so B5:B3 becomes B3:B5. Cross-sheet refs and columns outside the sort
 * domain are left untouched.
 */
export interface RemapScope {
  /** When set, `SheetName!A1`-scoped tokens naming this sheet also remap. */
  readonly sheetName?: string;
  /** Other-sheet formulas: only tokens explicitly scoped to sheetName remap. */
  readonly scopedOnly?: boolean;
}

export function remapFormulaRows(formula: string, rows: ReadonlyMap<number, number>, c1: number, c2: number, scope?: RemapScope): string {
  return formula.replace(REF_OR_RANGE_TOKEN, (token, offset: number) => {
    // A token glued to a preceding identifier, number, or '.' is part of a
    // function name or scientific literal. A '!' prefix marks a sheet scope:
    // remap only when it names the sorted sheet.
    const prev = formula[offset - 1];
    if (prev !== undefined && /[\w$.]/.test(prev)) return token;
    if (prev === '!') {
      const name = scopeNameBefore(formula, offset);
      if (scope?.sheetName === undefined || name !== scope.sheetName) return token;
    } else if (scope?.scopedOnly === true) return token;
    const parts = token.split(':');
    const start = parseRefToken(parts[0] ?? '');
    if (start === null) return token;
    const end = parts[1] !== undefined ? parseRefToken(parts[1]) : undefined;
    if (end === null || end === undefined) {
      if (!inSortDomain(start.c, c1, c2)) return token;
      const target = rows.get(start.r);
      if (target === undefined) return token;
      return rebuildRefTokenRow(parts[0] ?? '', target);
    }
    const startIn = inSortDomain(start.c, c1, c2);
    const endIn = inSortDomain(end.c, c1, c2);
    if (!startIn && !endIn) return token;
    const rLo = Math.min(start.r, end.r);
    const rHi = Math.max(start.r, end.r);
    let touched = false;
    for (let r = rLo; r <= rHi; r += 1) {
      if (rows.has(r)) { touched = true; break; }
    }
    if (!touched) return token;
    // Span must cover every image of the original rows (mapped or pinned).
    let mappedMin = Number.POSITIVE_INFINITY;
    let mappedMax = Number.NEGATIVE_INFINITY;
    for (let r = rLo; r <= rHi; r += 1) {
      const target = rows.get(r) ?? r;
      if (target < mappedMin) mappedMin = target;
      if (target > mappedMax) mappedMax = target;
    }
    let from = { ...start, r: mappedMin };
    let to = { ...end, r: mappedMax };
    if (to.r < from.r || (to.r === from.r && to.c < from.c)) {
      const swap = from;
      from = to;
      to = swap;
    }
    return `${rebuildRefTokenRow(parts[0] ?? '', from.r)}:${rebuildRefTokenRow(parts[1] ?? '', to.r)}`;
  });
}

/** Sheet name in the `Name!` / `'Name'!` scope immediately before `offset`. */
function scopeNameBefore(formula: string, offset: number): string | undefined {
  const before = formula.slice(0, offset);
  const match = before.match(/(?:'([^']+)'|([A-Za-z0-9_.\u4e00-\u9fa5]+))!$/);
  return match?.[1] ?? match?.[2];
}

/** Scope for insert/delete reference rewriting: which sheet's rows/cols moved. */
export interface ShiftScope {
  /** Name of the sheet where rows/cols were inserted or deleted. */
  readonly sheetName: string;
  /** True for formulas living on OTHER sheets: only `SheetName!`-scoped tokens shift. */
  readonly scopedOnly?: boolean;
}

/**
 * Rewrite references for a row insert (count > 0) or delete (count < 0) at
 * 0-based `start`, Excel semantics: refs below an insert shift down; ranges
 * spanning an insert grow at shifted endpoints only; deleted refs become
 * #REF!; ranges shrink with deleted endpoints clamping into the zone, and a
 * fully-deleted range becomes #REF!. Tokens scoped to another sheet and
 * (with scopedOnly) unscoped tokens in other sheets' formulas stay put.
 */
export function shiftFormulaRows(formula: string, start: number, count: number, scope?: ShiftScope): string {
  return formula.replace(REF_OR_RANGE_TOKEN, (token, offset: number) => {
    if (!tokenInShiftScope(formula, offset, scope)) return token;
    const clamp = (i: number): number => Math.min(i, TOTAL_ROWS - 1); // fixed grid: Excel clamps refs at the edge
    const parts = token.split(':');
    if (parts.length === 1) {
      const ref = parseRefToken(token);
      if (ref === null) return token;
      const mapped = shiftAxis(ref.r, start, count);
      return mapped < 0 ? '#REF!' : rebuildRefTokenRow(token, clamp(mapped));
    }
    const head = parseRefToken(parts[0] ?? '');
    const tail = parseRefToken(parts[1] ?? '');
    if (head === null || tail === null) return token;
    const shifted = shiftRangeAxis(head.r, tail.r, start, count);
    if (shifted === '#REF!') return '#REF!';
    const [lo, hi] = shifted;
    return `${rebuildRefTokenRow(parts[0] ?? '', clamp(lo))}:${rebuildRefTokenRow(parts[1] ?? '', clamp(hi))}`;
  });
}

/** Column counterpart of {@link shiftFormulaRows}. */
export function shiftFormulaCols(formula: string, start: number, count: number, scope?: ShiftScope): string {
  return formula.replace(REF_OR_RANGE_TOKEN, (token, offset: number) => {
    if (!tokenInShiftScope(formula, offset, scope)) return token;
    const clamp = (i: number): number => Math.min(i, TOTAL_COLS - 1); // fixed grid: Excel clamps refs at the edge
    const parts = token.split(':');
    if (parts.length === 1) {
      const ref = parseRefToken(token);
      if (ref === null) return token;
      const mapped = shiftAxis(ref.c, start, count);
      return mapped < 0 ? '#REF!' : rebuildRefTokenCol(token, clamp(mapped));
    }
    const head = parseRefToken(parts[0] ?? '');
    const tail = parseRefToken(parts[1] ?? '');
    if (head === null || tail === null) return token;
    const shifted = shiftRangeAxis(head.c, tail.c, start, count);
    if (shifted === '#REF!') return '#REF!';
    const [lo, hi] = shifted;
    return `${rebuildRefTokenCol(parts[0] ?? '', clamp(lo))}:${rebuildRefTokenCol(parts[1] ?? '', clamp(hi))}`;
  });
}

function tokenInShiftScope(formula: string, offset: number, scope: ShiftScope | undefined): boolean {
  const prev = formula[offset - 1];
  if (prev !== undefined && /[\w$.]/.test(prev)) return false;
  if (prev === '!') return scopeNameBefore(formula, offset) === scope?.sheetName;
  return scope?.scopedOnly !== true;
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
function shiftRangeAxis(a: number, b: number, start: number, count: number): readonly [number, number] | '#REF!' {
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
  const read = (part: string | undefined): { readonly r: number; readonly c: number } | null => {
    const coords = (part ?? '').split(',').map(Number);
    const r = coords[0];
    const c = coords[1];
    return r !== undefined && c !== undefined && Number.isFinite(r) && Number.isFinite(c) ? { r, c } : null;
  };
  const parts = range.split(':');
  const head = read(parts[0]);
  const tail = parts[1] !== undefined ? read(parts[1]) : head;
  if (head === null || tail === null) return range;
  const pick = (p: { readonly r: number; readonly c: number }): number => (axis === 'row' ? p.r : p.c);
  const shifted = shiftRangeAxis(pick(head), pick(tail), start, count);
  if (shifted === '#REF!') return null;
  const max = axis === 'row' ? TOTAL_ROWS - 1 : TOTAL_COLS - 1;
  const [lo, hi] = shifted;
  const rebuild = (p: { readonly r: number; readonly c: number }, v: number): string =>
    axis === 'row' ? `${Math.min(v, max)},${p.c}` : `${p.r},${Math.min(v, max)}`;
  const first = rebuild(head, lo);
  return parts[1] !== undefined ? `${first}:${rebuild(tail, hi)}` : first;
}

function rebuildRefTokenRow(token: string, r0: number): string {
  return token.replace(/[1-9]\d*$/, String(r0 + 1));
}

function rebuildRefTokenCol(token: string, c0: number): string {
  return token.replace(/^(\$?)[A-Za-z]+/, (_, dollar: string) => `${dollar}${num2alpha(c0)}`);
}

function inSortDomain(col: number, c1: number, c2: number): boolean {
  return col >= c1 && col <= c2;
}

function parseRefToken(token: string): { readonly r: number; readonly c: number } | null {
  const match = token.match(/^(\$?)([A-Za-z]{1,3})(\$?)([1-9]\d*)$/);
  if (match === null || match[2] === undefined || match[4] === undefined) return null;
  return { r: Number(match[4]) - 1, c: alpha2num(match[2].toUpperCase()) };
}

export function formulaDependencies(formula: string): string[] {
  const deps = new Set<string>();
  const pattern = /(?:'[^']+'|[A-Za-z][A-Za-z0-9_]*)?!?[A-Za-z]+[1-9]\d*(?::[A-Za-z]+[1-9]\d*)?/g;
  for (const match of formula.matchAll(pattern)) addDependencyMatch(deps, match[0]);
  return [...deps];
}

function addDependencyMatch(deps: Set<string>, expr: string): void {
  const bangIndex = expr.indexOf('!');
  const sheetName = bangIndex > 0 ? expr.slice(0, bangIndex).replace(/^'|'$/g, '') : undefined;
  const unscoped = bangIndex > 0 ? expr.slice(bangIndex + 1) : expr;
  const parts = unscoped.split(':');
  const start = parts[0];
  const end = parts[1];
  if (start === undefined) return;
  if (end === undefined) {
    const id = exprToCellId(start);
    deps.add(sheetName !== undefined ? `${sheetName}:${id}` : id);
    return;
  }
  addRangeDependencies(deps, start, end, sheetName);
}

function addRangeDependencies(deps: Set<string>, start: string, end: string, sheetName?: string): void {
  const a = exprToCoords(start);
  const b = exprToCoords(end);
  for (let r = Math.min(a.r, b.r); r <= Math.max(a.r, b.r); r += 1) {
    for (let c = Math.min(a.c, b.c); c <= Math.max(a.c, b.c); c += 1) {
      const id = cellId(r, c);
      deps.add(sheetName !== undefined ? `${sheetName}:${id}` : id);
    }
  }
}

function exprToCellId(expr: string): string {
  const coords = exprToCoords(expr);
  return cellId(coords.r, coords.c);
}

export function parseRange(rangeStr: string): { r1: number; c1: number; r2: number; c2: number } {
  const parts = rangeStr.split(':');
  const start = exprToCoords(parts[0] ?? rangeStr);
  const end = parts[1] !== undefined ? exprToCoords(parts[1]) : start;
  return { r1: Math.min(start.r, end.r), c1: Math.min(start.c, end.c), r2: Math.max(start.r, end.r), c2: Math.max(start.c, end.c) };
}

function exprToCoords(expr: string): CellAddress {
  const match = expr.match(/^([A-Za-z]+)([1-9]\d*)$/);
  const col = match?.[1];
  const row = match?.[2];
  if (col === undefined || row === undefined) return { r: 0, c: 0 };
  return { r: Number(row) - 1, c: alpha2num(col.toUpperCase()) };
}
