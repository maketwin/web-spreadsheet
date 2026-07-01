import type { Cell, CellValue } from '../types';
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

export function formulaDependencies(formula: string): string[] {
  const deps = new Set<string>();
  const pattern = /(?:'[^']+'|[A-Za-z][A-Za-z0-9_]*)?!?[A-Za-z]+[1-9]\d*(?::[A-Za-z]+[1-9]\d*)?/g;
  for (const match of formula.matchAll(pattern)) addDependencyMatch(deps, match[0]);
  return [...deps];
}

function addDependencyMatch(deps: Set<string>, expr: string): void {
  const unscoped = expr.includes('!') ? expr.slice(expr.indexOf('!') + 1) : expr;
  const parts = unscoped.split(':');
  const start = parts[0];
  const end = parts[1];
  if (start === undefined) return;
  if (end === undefined) {
    deps.add(exprToCellId(start));
    return;
  }
  addRangeDependencies(deps, start, end);
}

function addRangeDependencies(deps: Set<string>, start: string, end: string): void {
  const a = exprToCoords(start);
  const b = exprToCoords(end);
  for (let r = Math.min(a.r, b.r); r <= Math.max(a.r, b.r); r += 1) {
    for (let c = Math.min(a.c, b.c); c <= Math.max(a.c, b.c); c += 1) deps.add(cellId(r, c));
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
