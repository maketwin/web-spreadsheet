import { registry } from './registry';
import type { AstNode, CellResolver, FormulaArgument, FormulaValue } from './types';

export type NamedRangeResolver = (name: string) => AstNode | null;

export function evaluate(node: AstNode, resolve: CellResolver, resolveName?: NamedRangeResolver): FormulaArgument {
  switch (node.type) {
    case 'number':
      return node.value;
    case 'string':
      return node.value;
    case 'cell':
      return resolve(node.x, node.y, node.sheetName);
    case 'range':
      return evaluateRange(node, resolve);
    case 'func':
      return evaluateFunction(node, resolve, resolveName);
    case 'binary':
      return evaluateBinary(node, resolve, resolveName);
    case 'unary':
      return evaluateUnary(node, resolve, resolveName);
    case 'name':
      return evaluateName(node, resolve, resolveName);
  }
}

function evaluateRange(node: Extract<AstNode, { type: 'range' }>, resolve: CellResolver): readonly FormulaValue[] {
  const values: FormulaValue[] = [];
  const x1 = Math.min(node.x1, node.x2);
  const x2 = Math.max(node.x1, node.x2);
  const y1 = Math.min(node.y1, node.y2);
  const y2 = Math.max(node.y1, node.y2);

  for (let y = y1; y <= y2; y += 1) {
    for (let x = x1; x <= x2; x += 1) values.push(resolve(x, y, node.sheetName));
  }
  return values;
}

function evaluateFunction(node: Extract<AstNode, { type: 'func' }>, resolve: CellResolver, resolveName?: NamedRangeResolver): FormulaArgument {
  // VLOOKUP needs the 2-D shape of its table range, which the flat
  // FormulaArgument list cannot express — resolved per-cell here instead.
  if (node.name === 'VLOOKUP') return vlookup(node, resolve, resolveName);
  const spec = registry.get(node.name);
  if (!spec) return null;
  return spec.evaluate(node.args.map((arg) => evaluate(arg, resolve, resolveName)));
}

/**
 * Excel VLOOKUP(lookup, table, colIndex, [rangeLookup]): exact match when
 * rangeLookup is FALSE/0 (case-insensitive for text); otherwise approximate
 * match on an ascending-sorted first column (largest key <= lookup).
 * Returns '#N/A' when no match exists, like Excel.
 */
function vlookup(node: Extract<AstNode, { type: 'func' }>, resolve: CellResolver, resolveName?: NamedRangeResolver): FormulaValue {
  const [lookupArg, tableArg, colArg, rangeArg] = node.args;
  if (lookupArg === undefined || tableArg === undefined || colArg === undefined) return null;
  if (tableArg.type !== 'range') return null;
  const lookup = scalar(evaluate(lookupArg, resolve, resolveName));
  const colIndex = Number(scalar(evaluate(colArg, resolve, resolveName)));
  const approximate = rangeArg === undefined ? true : Boolean(scalar(evaluate(rangeArg, resolve, resolveName)));
  const x1 = Math.min(tableArg.x1, tableArg.x2);
  const x2 = Math.max(tableArg.x1, tableArg.x2);
  const y1 = Math.min(tableArg.y1, tableArg.y2);
  const y2 = Math.max(tableArg.y1, tableArg.y2);
  if (!Number.isInteger(colIndex) || colIndex < 1 || colIndex > x2 - x1 + 1) return null;
  let approximateHit: FormulaValue = null;
  for (let y = y1; y <= y2; y += 1) {
    const key = resolve(x1, y, tableArg.sheetName);
    if (excelEquals(key, lookup)) return resolve(x1 + colIndex - 1, y, tableArg.sheetName);
    if (approximate && lookup !== null && key !== null) {
      const order = compare(key, lookup);
      if (order <= 0) approximateHit = resolve(x1 + colIndex - 1, y, tableArg.sheetName);
      else break; // first column is assumed ascending: past the last candidate
    }
  }
  return approximate ? (approximateHit ?? '#N/A') : '#N/A';
}

function evaluateBinary(node: Extract<AstNode, { type: 'binary' }>, resolve: CellResolver, resolveName?: NamedRangeResolver): FormulaValue {
  const left = scalar(evaluate(node.left, resolve, resolveName));
  const right = scalar(evaluate(node.right, resolve, resolveName));

  // Excel error values ('#DIV/0!', '#N/A', …) propagate through arithmetic.
  const leftError = errorValueOf(left);
  if (leftError !== undefined) return leftError;
  const rightError = errorValueOf(right);
  if (rightError !== undefined) return rightError;

  switch (node.op) {
    case '+':
      return finiteOrError(Number(left) + Number(right));
    case '-':
      return finiteOrError(Number(left) - Number(right));
    case '*':
      return finiteOrError(Number(left) * Number(right));
    case '/':
      if (Number(right) === 0) return '#DIV/0!';
      return finiteOrError(Number(left) / Number(right));
    case '&':
      return `${textOf(left)}${textOf(right)}`;
    case '>':
      return compare(left, right) > 0;
    case '<':
      return compare(left, right) < 0;
    case '>=':
      return compare(left, right) >= 0;
    case '<=':
      return compare(left, right) <= 0;
    case '=':
      return excelEquals(left, right);
    case '<>':
      return !excelEquals(left, right);
    default:
      return null;
  }
}

/** Excel comparison: numeric when both sides are numeric, else case-insensitive text. */
function compare(a: FormulaValue, b: FormulaValue): number {
  const an = numericOr(a);
  const bn = numericOr(b);
  if (an !== undefined && bn !== undefined) return an - bn;
  return textOf(a).toLowerCase().localeCompare(textOf(b).toLowerCase());
}

/** The seven Excel error literals; plain text like "#tag" must NOT be treated as an error. */
const EXCEL_ERRORS: ReadonlySet<string> = new Set(['#NULL!', '#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#NUM!', '#N/A']);

/** A cell/formula value that is itself an Excel error literal ('#DIV/0!', '#N/A', …). */
function errorValueOf(v: FormulaValue): string | undefined {
  return typeof v === 'string' && EXCEL_ERRORS.has(v) ? v : undefined;
}

/** Map JS arithmetic accidents to Excel error values: NaN → #VALUE!, ±Infinity → #NUM!. */
function finiteOrError(n: number): FormulaValue {
  if (Number.isNaN(n)) return '#VALUE!';
  if (!Number.isFinite(n)) return '#NUM!';
  return n;
}

/** Excel `=`: numbers compare numerically; text compares case-insensitively. */
export function excelEquals(a: FormulaValue, b: FormulaValue): boolean {
  if (typeof a === 'boolean' || typeof b === 'boolean') return a === b;
  return compare(a, b) === 0;
}

function numericOr(v: FormulaValue): number | undefined {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (!Number.isNaN(n)) return n;
  }
  return undefined;
}

function textOf(v: FormulaValue): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function evaluateUnary(node: Extract<AstNode, { type: 'unary' }>, resolve: CellResolver, resolveName?: NamedRangeResolver): FormulaValue {
  const value = scalar(evaluate(node.operand, resolve, resolveName));
  return node.op === '-' ? -Number(value) : Number(value);
}

function evaluateName(node: Extract<AstNode, { type: 'name' }>, resolve: CellResolver, resolveName?: NamedRangeResolver): FormulaArgument {
  if (resolveName === undefined) return null;
  const resolved = resolveName(node.value);
  if (resolved === null) return null;
  return evaluate(resolved, resolve, resolveName);
}

function scalar(value: FormulaArgument): FormulaValue {
  if (isFormulaList(value)) return value[0] ?? null;
  return value;
}

function isFormulaList(value: FormulaArgument): value is readonly FormulaValue[] {
  return Array.isArray(value);
}
