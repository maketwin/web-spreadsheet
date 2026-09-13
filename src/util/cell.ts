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
 * the row permutation, mirroring Excel sort semantics: moved formulas keep
 * referencing the same logical data. Range endpoints are re-normalized so a
 * permutation cannot flip a range like B2:B4 into B5:B3. References outside
 * the range (and cross-sheet references) are left untouched.
 */
export function remapFormulaRows(formula: string, rows: ReadonlyMap<number, number>, c1: number, c2: number): string {
  return formula.replace(REF_OR_RANGE_TOKEN, (token, offset: number) => {
    // A token glued to a preceding identifier, number, '!', or '.' is part
    // of a function name, scientific literal, or cross-sheet reference.
    const prev = formula[offset - 1];
    if (prev !== undefined && /[\w$!.]/.test(prev)) return token;
    const parts = token.split(':');
    const start = parseRefToken(parts[0] ?? '');
    if (start === null) return token;
    const end = parts[1] !== undefined ? parseRefToken(parts[1]) : undefined;
    const startTarget = inSortDomain(start.c, c1, c2) ? rows.get(start.r) : undefined;
    const endTarget = end !== null && end !== undefined && inSortDomain(end.c, c1, c2) ? rows.get(end.r) : undefined;
    if (startTarget === undefined && endTarget === undefined) return token;
    let from = { ...start, r: startTarget ?? start.r };
    let to = end === null || end === undefined ? null : { ...end, r: endTarget ?? end.r };
    if (to !== null && (to.r < from.r || (to.r === from.r && to.c < from.c))) {
      const swap = from;
      from = to;
      to = swap;
    }
    const rebuilt = rebuildRefToken(parts[0] ?? '', from.r);
    return to === null ? rebuilt : `${rebuilt}:${rebuildRefToken(parts[1] ?? '', to.r)}`;
  });
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
