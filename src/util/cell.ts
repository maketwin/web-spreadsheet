import type { Cell, CellValue, Style } from '../types';
import { formatValue } from '../format/NumberFormatter';
import { alpha2num } from './alphabet';

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
      return rebuildRefToken(parts[0] ?? '', target);
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
    return `${rebuildRefToken(parts[0] ?? '', from.r)}:${rebuildRefToken(parts[1] ?? '', to.r)}`;
  });
}

/** Sheet name in the `Name!` / `'Name'!` scope immediately before `offset`. */
function scopeNameBefore(formula: string, offset: number): string | undefined {
  const before = formula.slice(0, offset);
  const match = before.match(/(?:'([^']+)'|([A-Za-z0-9_.\u4e00-\u9fa5]+))!$/);
  return match?.[1] ?? match?.[2];
}

function inSortDomain(col: number, c1: number, c2: number): boolean {
  return col >= c1 && col <= c2;
}

function rebuildRefToken(token: string, r0: number): string {
  return token.replace(/[1-9]\d*$/, String(r0 + 1));
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
