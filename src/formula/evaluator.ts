import { registry } from './registry';
import type { AstNode, CellResolver, FormulaArgument, FormulaValue } from './types';

export type NamedRangeResolver = (name: string) => AstNode | null;

/** Optional evaluation context (row visibility for SUBTOTAL, etc.). */
export interface EvalContext {
  readonly isRowHidden?: (row: number, sheetName?: string) => boolean;
}

export function evaluate(
  node: AstNode,
  resolve: CellResolver,
  resolveName?: NamedRangeResolver,
  ctx?: EvalContext,
): FormulaArgument {
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
      return evaluateFunction(node, resolve, resolveName, ctx);
    case 'binary':
      return evaluateBinary(node, resolve, resolveName, ctx);
    case 'unary':
      return evaluateUnary(node, resolve, resolveName, ctx);
    case 'name':
      return evaluateName(node, resolve, resolveName, ctx);
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

function evaluateFunction(
  node: Extract<AstNode, { type: 'func' }>,
  resolve: CellResolver,
  resolveName?: NamedRangeResolver,
  ctx?: EvalContext,
): FormulaArgument {
  // Lookup / SUBTOTAL need 2-D ranges or row visibility — resolved here.
  if (node.name === 'VLOOKUP') return vlookup(node, resolve, resolveName, ctx);
  if (node.name === 'HLOOKUP') return hlookup(node, resolve, resolveName, ctx);
  if (node.name === 'XLOOKUP') return xlookup(node, resolve, resolveName, ctx);
  if (node.name === 'SUBTOTAL') return subtotal(node, resolve, resolveName, ctx);
  // IF is lazy in Excel: an error in the not-taken branch does not propagate.
  if (node.name === 'IF') return ifLazy(node, resolve, resolveName, ctx);
  // IFERROR / IFNA must see the error value instead of short-circuit propagation.
  if (node.name === 'IFERROR' || node.name === 'IFNA') return ifErrorLike(node, resolve, resolveName, ctx);
  const spec = registry.get(node.name);
  if (!spec) return '#NAME?';
  const args = node.args.map((arg) => evaluate(arg, resolve, resolveName, ctx));
  // Excel: most functions propagate error args; IS* inspect them instead.
  if (!ERROR_INSPECTING.has(node.name)) {
    for (const arg of args) {
      const err = firstErrorIn(arg);
      if (err !== undefined) return err;
    }
  }
  return guardNumeric(spec.evaluate(args));
}

/** Excel IF(cond, then, [else]): evaluates only the taken branch. */
function ifLazy(node: Extract<AstNode, { type: 'func' }>, resolve: CellResolver, resolveName?: NamedRangeResolver, ctx?: EvalContext): FormulaValue {
  const [condArg, thenArg, elseArg] = node.args;
  if (condArg === undefined) return null;
  const cond = scalar(evaluate(condArg, resolve, resolveName, ctx));
  const condError = errorValueOf(cond);
  if (condError !== undefined) return condError;
  if (cond === false || cond === 0 || cond === null || cond === '') {
    return elseArg === undefined ? false : scalar(evaluate(elseArg, resolve, resolveName, ctx));
  }
  return thenArg === undefined ? null : scalar(evaluate(thenArg, resolve, resolveName, ctx));
}

/** Excel IFERROR(value, fallback) / IFNA(value, fallback). */
function ifErrorLike(node: Extract<AstNode, { type: 'func' }>, resolve: CellResolver, resolveName?: NamedRangeResolver, ctx?: EvalContext): FormulaValue {
  const [valueArg, fallbackArg] = node.args;
  if (valueArg === undefined) return null;
  const value = scalar(evaluate(valueArg, resolve, resolveName, ctx));
  const err = errorValueOf(value);
  const naOnly = node.name === 'IFNA';
  if (err !== undefined && (!naOnly || err === '#N/A')) {
    return fallbackArg === undefined ? null : scalar(evaluate(fallbackArg, resolve, resolveName, ctx));
  }
  return value;
}

/** Map a function's non-finite numeric result to an Excel error literal. */
function guardNumeric(result: FormulaArgument): FormulaArgument {
  if (typeof result === 'number' && !Number.isFinite(result)) return finiteOrError(result);
  return result;
}

function firstErrorIn(value: FormulaArgument): string | undefined {
  if (isFormulaList(value)) {
    for (const entry of value) {
      const err = errorValueOf(entry);
      if (err !== undefined) return err;
    }
    return undefined;
  }
  return errorValueOf(value);
}

/**
 * Excel VLOOKUP(lookup, table, colIndex, [rangeLookup]): exact match when
 * rangeLookup is FALSE/0 (case-insensitive for text); otherwise approximate
 * match on an ascending-sorted first column (largest key <= lookup).
 * Returns '#N/A' when no match exists, like Excel.
 */
function vlookup(node: Extract<AstNode, { type: 'func' }>, resolve: CellResolver, resolveName?: NamedRangeResolver, ctx?: EvalContext): FormulaValue {
  const [lookupArg, tableArg, colArg, rangeArg] = node.args;
  if (lookupArg === undefined || tableArg === undefined || colArg === undefined) return null;
  if (tableArg.type !== 'range') return null;
  const lookup = scalar(evaluate(lookupArg, resolve, resolveName, ctx));
  const colIndex = Number(scalar(evaluate(colArg, resolve, resolveName, ctx)));
  const approximate = rangeArg === undefined ? true : Boolean(scalar(evaluate(rangeArg, resolve, resolveName, ctx)));
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


/**
 * Excel HLOOKUP(lookup, table, rowIndex, [rangeLookup]) — search first row, return row.
 */
function hlookup(node: Extract<AstNode, { type: 'func' }>, resolve: CellResolver, resolveName?: NamedRangeResolver, ctx?: EvalContext): FormulaValue {
  const [lookupArg, tableArg, rowArg, rangeArg] = node.args;
  if (lookupArg === undefined || tableArg === undefined || rowArg === undefined) return null;
  if (tableArg.type !== 'range') return null;
  const lookup = scalar(evaluate(lookupArg, resolve, resolveName, ctx));
  const rowIndex = Number(scalar(evaluate(rowArg, resolve, resolveName, ctx)));
  const approximate = rangeArg === undefined ? true : Boolean(scalar(evaluate(rangeArg, resolve, resolveName, ctx)));
  const x1 = Math.min(tableArg.x1, tableArg.x2);
  const x2 = Math.max(tableArg.x1, tableArg.x2);
  const y1 = Math.min(tableArg.y1, tableArg.y2);
  const y2 = Math.max(tableArg.y1, tableArg.y2);
  if (!Number.isInteger(rowIndex) || rowIndex < 1 || rowIndex > y2 - y1 + 1) return null;
  let approximateHit: FormulaValue = null;
  for (let x = x1; x <= x2; x += 1) {
    const key = resolve(x, y1, tableArg.sheetName);
    if (excelEquals(key, lookup)) return resolve(x, y1 + rowIndex - 1, tableArg.sheetName);
    if (approximate && lookup !== null && key !== null) {
      const order = compare(key, lookup);
      if (order <= 0) approximateHit = resolve(x, y1 + rowIndex - 1, tableArg.sheetName);
      else break;
    }
  }
  return approximate ? (approximateHit ?? '#N/A') : '#N/A';
}

/**
 * Excel XLOOKUP(lookup, lookup_array, return_array, [if_not_found], [match_mode], [search_mode]).
 * This build: exact (0) + wildcard (2); search first-to-last (1) or last-to-first (-1).
 * Multi-cell return arrays yield the aligned single cell (no spill).
 */
function xlookup(node: Extract<AstNode, { type: 'func' }>, resolve: CellResolver, resolveName?: NamedRangeResolver, ctx?: EvalContext): FormulaValue {
  const [lookupArg, lookupArrArg, returnArrArg, ifNotFoundArg, matchModeArg, searchModeArg] = node.args;
  if (lookupArg === undefined || lookupArrArg === undefined || returnArrArg === undefined) return null;
  if (lookupArrArg.type !== 'range' || returnArrArg.type !== 'range') return '#VALUE!';
  const lookup = scalar(evaluate(lookupArg, resolve, resolveName, ctx));
  const matchMode = matchModeArg === undefined ? 0 : Number(scalar(evaluate(matchModeArg, resolve, resolveName, ctx)));
  const searchMode = searchModeArg === undefined ? 1 : Number(scalar(evaluate(searchModeArg, resolve, resolveName, ctx)));
  if (matchMode !== 0 && matchMode !== 2) return '#N/A'; // approximate modes not in this build
  if (searchMode !== 1 && searchMode !== -1) return '#N/A';

  const lx1 = Math.min(lookupArrArg.x1, lookupArrArg.x2);
  const lx2 = Math.max(lookupArrArg.x1, lookupArrArg.x2);
  const ly1 = Math.min(lookupArrArg.y1, lookupArrArg.y2);
  const ly2 = Math.max(lookupArrArg.y1, lookupArrArg.y2);
  const rx1 = Math.min(returnArrArg.x1, returnArrArg.x2);
  const rx2 = Math.max(returnArrArg.x1, returnArrArg.x2);
  const ry1 = Math.min(returnArrArg.y1, returnArrArg.y2);
  const ry2 = Math.max(returnArrArg.y1, returnArrArg.y2);

  const lookupIsCol = lx1 === lx2;
  const lookupIsRow = ly1 === ly2;
  if (!lookupIsCol && !lookupIsRow) return '#VALUE!';

  type Hit = { keyX: number; keyY: number; index: number };
  const hits: Hit[] = [];
  if (lookupIsCol) {
    const len = ly2 - ly1 + 1;
    if (ry2 - ry1 + 1 !== len) return '#VALUE!';
    for (let i = 0; i < len; i += 1) hits.push({ keyX: lx1, keyY: ly1 + i, index: i });
  } else {
    const len = lx2 - lx1 + 1;
    if (rx2 - rx1 + 1 !== len) return '#VALUE!';
    for (let i = 0; i < len; i += 1) hits.push({ keyX: lx1 + i, keyY: ly1, index: i });
  }
  const order = searchMode === -1 ? [...hits].reverse() : hits;

  for (const hit of order) {
    const key = resolve(hit.keyX, hit.keyY, lookupArrArg.sheetName);
    const matched = matchMode === 2
      ? wildcardEquals(key, lookup)
      : excelEquals(key, lookup);
    if (!matched) continue;
    if (lookupIsCol) {
      const retX = rx1; // first return column when multi-col (no spill)
      return resolve(retX, ry1 + hit.index, returnArrArg.sheetName);
    }
    const retY = ry1;
    return resolve(rx1 + hit.index, retY, returnArrArg.sheetName);
  }

  if (ifNotFoundArg !== undefined) return scalar(evaluate(ifNotFoundArg, resolve, resolveName, ctx));
  return '#N/A';
}

function wildcardEquals(value: FormulaValue, pattern: FormulaValue): boolean {
  const text = String(value ?? '');
  const pat = String(pattern ?? '');
  if (!/[*?]/.test(pat)) return excelEquals(value, pattern);
  const escaped = pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i').test(text);
}

/**
 * Excel SUBTOTAL(fn, ref1, …). Function 1–11 / 101–111.
 * Hidden rows (`RowMeta.hide`, including AutoFilter) are skipped for both families
 * (store does not distinguish filter vs manual hide).
 */
function subtotal(node: Extract<AstNode, { type: 'func' }>, resolve: CellResolver, resolveName?: NamedRangeResolver, ctx?: EvalContext): FormulaValue {
  const [fnArg, ...rest] = node.args;
  if (fnArg === undefined || rest.length === 0) return null;
  const rawFn = Number(scalar(evaluate(fnArg, resolve, resolveName, ctx)));
  if (!Number.isFinite(rawFn)) return '#VALUE!';
  const fn = Math.trunc(rawFn);
  const base = fn >= 101 ? fn - 100 : fn;
  if (base < 1 || base > 11) return '#VALUE!';

  const values: FormulaValue[] = [];
  for (const arg of rest) {
    if (arg.type === 'range') {
      const x1 = Math.min(arg.x1, arg.x2);
      const x2 = Math.max(arg.x1, arg.x2);
      const y1 = Math.min(arg.y1, arg.y2);
      const y2 = Math.max(arg.y1, arg.y2);
      for (let y = y1; y <= y2; y += 1) {
        if (ctx?.isRowHidden?.(y, arg.sheetName) === true) continue;
        for (let x = x1; x <= x2; x += 1) values.push(resolve(x, y, arg.sheetName));
      }
    } else {
      const v = evaluate(arg, resolve, resolveName, ctx);
      if (isFormulaList(v)) values.push(...v);
      else values.push(v);
    }
  }

  const nums = values.flatMap((v) => (typeof v === 'number' && Number.isFinite(v) ? [v] : []));
  switch (base) {
    case 1: // AVERAGE
      return nums.length === 0 ? '#DIV/0!' : nums.reduce((a, b) => a + b, 0) / nums.length;
    case 2: // COUNT
      return nums.length;
    case 3: // COUNTA
      return values.filter((v) => v !== null && v !== undefined && v !== '').length;
    case 4: // MAX
      return nums.length === 0 ? 0 : Math.max(...nums);
    case 5: // MIN
      return nums.length === 0 ? 0 : Math.min(...nums);
    case 6: { // PRODUCT
      if (nums.length === 0) return 0;
      return nums.reduce((a, b) => a * b, 1);
    }
    case 9: // SUM
      return nums.reduce((a, b) => a + b, 0);
    case 7: // STDEV
    case 8: // STDEVP
    case 10: // VAR
    case 11: // VARP
      return '#N/A'; // not in this build
    default:
      return '#VALUE!';
  }
}

function evaluateBinary(node: Extract<AstNode, { type: 'binary' }>, resolve: CellResolver, resolveName?: NamedRangeResolver, ctx?: EvalContext): FormulaValue {
  const left = scalar(evaluate(node.left, resolve, resolveName, ctx));
  const right = scalar(evaluate(node.right, resolve, resolveName, ctx));

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
    case '^':
      if (Number(right) === 0 && Number(left) === 0) return '#NUM!';
      return finiteOrError(Math.pow(Number(left), Number(right)));
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
const ERROR_INSPECTING: ReadonlySet<string> = new Set([
  'ISERROR', 'ISERR', 'ISNA', 'ISBLANK', 'ISNUMBER', 'ISTEXT', 'ISLOGICAL', 'ISNONTEXT',
]);

export const EXCEL_ERRORS: ReadonlySet<string> = new Set(['#NULL!', '#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#NUM!', '#N/A']);

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

function evaluateUnary(node: Extract<AstNode, { type: 'unary' }>, resolve: CellResolver, resolveName?: NamedRangeResolver, ctx?: EvalContext): FormulaValue {
  const value = scalar(evaluate(node.operand, resolve, resolveName, ctx));
  const err = errorValueOf(value);
  if (err !== undefined) return err;
  return finiteOrError(node.op === '-' ? -Number(value) : Number(value));
}

function evaluateName(node: Extract<AstNode, { type: 'name' }>, resolve: CellResolver, resolveName?: NamedRangeResolver, ctx?: EvalContext): FormulaArgument {
  // Excel boolean literals are ordinary identifiers, case-insensitive.
  const upper = node.value.toUpperCase();
  if (upper === 'TRUE') return true;
  if (upper === 'FALSE') return false;
  if (resolveName === undefined) return '#NAME?';
  const resolved = resolveName(node.value);
  if (resolved === null) return '#NAME?';
  return evaluate(resolved, resolve, resolveName, ctx);
}

function scalar(value: FormulaArgument): FormulaValue {
  if (isFormulaList(value)) return value[0] ?? null;
  return value;
}

function isFormulaList(value: FormulaArgument): value is readonly FormulaValue[] {
  return Array.isArray(value);
}
