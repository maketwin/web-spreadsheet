import { registry } from './registry';
import type { AstNode, CellResolver, FormulaArgument, FormulaValue } from './types';

export type NamedRangeResolver = (name: string) => AstNode | null;

/** Optional evaluation context (row visibility for SUBTOTAL, etc.). */
export interface EvalContext {
  readonly isRowHidden?: (row: number, sheetName?: string) => boolean;
  /** The cell the formula lives in — ROW()/COLUMN() without args (Excel). */
  readonly currentCell?: { readonly r: number; readonly c: number };
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
  if (node.name === 'INDEX') return indexFn(node, resolve, resolveName, ctx);
  if (node.name === 'MATCH') return matchFn(node, resolve, resolveName, ctx);
  if (node.name === 'SUBTOTAL') return subtotal(node, resolve, resolveName, ctx);
  if (node.name === 'ROW' || node.name === 'COLUMN' || node.name === 'ROWS' || node.name === 'COLUMNS') {
    return positionInfo(node, resolveName, ctx);
  }
  // IF is lazy in Excel: an error in the not-taken branch does not propagate.
  if (node.name === 'IF') return ifLazy(node, resolve, resolveName, ctx);
  // IFS / SWITCH are lazy the same way; SWITCH matches candidates in order.
  if (node.name === 'IFS') return ifsLazy(node, resolve, resolveName, ctx);
  if (node.name === 'SWITCH') return switchFn(node, resolve, resolveName, ctx);
  // INDIRECT / OFFSET produce references from text or a shifted base — they see
  // the raw AST instead of eagerly flattened values. Caveat: the dependency
  // graph tracks only the static base; edits to the dynamically-targeted cells
  // do not by themselves trigger a recalc of these formulas.
  if (node.name === 'INDIRECT') return indirect(node, resolve, resolveName, ctx);
  if (node.name === 'OFFSET') return offset(node, resolve, resolveName, ctx);
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

/** ROW([ref]) / COLUMN([ref]) / ROWS(ref) / COLUMNS(ref) — ref-aware, so they
 * see the raw range shape instead of the flattened value list. */
function positionInfo(
  node: Extract<AstNode, { type: 'func' }>,
  resolveName?: NamedRangeResolver,
  ctx?: EvalContext,
): FormulaValue {
  const arg = node.args[0];
  const resolved: AstNode | null = arg === undefined
    ? null
    : arg.type === 'name' && resolveName !== undefined
      ? resolveName(arg.value)
      : arg;
  const noRef = resolved === null || resolved === undefined;
  switch (node.name) {
    case 'ROW':
      if (noRef) return (ctx?.currentCell?.r ?? 0) + 1;
      if (resolved!.type === 'cell') return resolved!.y + 1;
      if (resolved!.type === 'range') return Math.min(resolved!.y1, resolved!.y2) + 1;
      return 1;
    case 'COLUMN':
      if (noRef) return (ctx?.currentCell?.c ?? 0) + 1;
      if (resolved!.type === 'cell') return resolved!.x + 1;
      if (resolved!.type === 'range') return Math.min(resolved!.x1, resolved!.x2) + 1;
      return 1;
    case 'ROWS':
      if (resolved === null || resolved === undefined) return 1;
      if (resolved.type === 'cell') return 1;
      if (resolved.type === 'range') return Math.abs(resolved.y2 - resolved.y1) + 1;
      return 1;
    case 'COLUMNS':
      if (resolved === null || resolved === undefined) return 1;
      if (resolved.type === 'cell') return 1;
      if (resolved.type === 'range') return Math.abs(resolved.x2 - resolved.x1) + 1;
      return 1;
    default:
      return null;
  }
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

/** Excel truthiness for IF/IFS/SWITCH conditions: only 0, FALSE, blank and '' are falsy. */
function conditionErrorOrTruthy(cond: FormulaValue): string | boolean {
  const err = errorValueOf(cond);
  if (err !== undefined) return err;
  return !(cond === false || cond === 0 || cond === null || cond === '');
}

/** Excel IFS(cond1, value1, [cond2, value2], …) — first truthy condition wins; #N/A when none. */
function ifsLazy(node: Extract<AstNode, { type: 'func' }>, resolve: CellResolver, resolveName?: NamedRangeResolver, ctx?: EvalContext): FormulaValue {
  const args = node.args;
  if (args.length < 2 || args.length % 2 !== 0) return '#VALUE!';
  for (let i = 0; i + 1 < args.length; i += 2) {
    const condArg = args[i];
    const valueArg = args[i + 1];
    if (condArg === undefined || valueArg === undefined) return '#VALUE!';
    const cond = conditionErrorOrTruthy(scalar(evaluate(condArg, resolve, resolveName, ctx)));
    if (typeof cond === 'string') return cond;
    if (cond) return scalar(evaluate(valueArg, resolve, resolveName, ctx));
  }
  return '#N/A';
}

/** Excel SWITCH(expr, value1, result1, [value2, result2, …], [default]) — pairs
 * matched in order with Excel equality; a dangling final argument is the default. */
function switchFn(node: Extract<AstNode, { type: 'func' }>, resolve: CellResolver, resolveName?: NamedRangeResolver, ctx?: EvalContext): FormulaValue {
  const args = node.args;
  if (args.length < 3) return '#VALUE!';
  const exprArg = args[0];
  if (exprArg === undefined) return '#VALUE!';
  const expr = scalar(evaluate(exprArg, resolve, resolveName, ctx));
  const exprErr = errorValueOf(expr);
  if (exprErr !== undefined) return exprErr;
  let i = 1;
  for (; i + 1 < args.length; i += 2) {
    const candidateArg = args[i];
    const resultArg = args[i + 1];
    if (candidateArg === undefined || resultArg === undefined) break;
    const candidate = scalar(evaluate(candidateArg, resolve, resolveName, ctx));
    if (excelEquals(expr, candidate)) return scalar(evaluate(resultArg, resolve, resolveName, ctx));
  }
  const defaultArg = args[i];
  return defaultArg !== undefined ? scalar(evaluate(defaultArg, resolve, resolveName, ctx)) : '#N/A';
}

/** Parse the text accepted by INDIRECT: [Sheet!]A1, [Sheet!]A1:B2 ([$] anchors
 * allowed; quoted sheet names with spaces supported). */
function parseIndirectRef(text: string): { sheetName?: string | undefined; x1: number; y1: number; x2: number; y2: number } | null {
  const match = text.match(/^(?:(?:'((?:[^']|'')+)'|([A-Za-z0-9_\u4e00-\u9fff]+))!)?\$?([A-Za-z]{1,3})\$?([1-9]\d*)(?::\$?([A-Za-z]{1,3})\$?([1-9]\d*))?$/u);
  if (match === null) return null;
  const sheetName = match[1] !== undefined ? match[1].replace(/''/g, "'") : match[2];
  const col = (token: string | undefined): number | null => {
    if (token === undefined) return null;
    let n = 0;
    for (const ch of token.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  };
  const x1 = col(match[3]);
  const y1 = Number(match[4]) - 1;
  if (x1 === null) return null;
  let x2 = x1;
  let y2 = y1;
  if (match[5] !== undefined && match[6] !== undefined) {
    const end = col(match[5]);
    if (end === null) return null;
    x2 = end;
    y2 = Number(match[6]) - 1;
  }
  return { sheetName, x1: Math.min(x1, x2), y1: Math.min(y1, y2), x2: Math.max(x1, x2), y2: Math.max(y1, y2) };
}

/** Excel INDIRECT(ref_text, [a1]) — resolve a text reference against the sheet.
 * R1C1 style (a1 = FALSE) is not supported and yields '#REF!'. */
function indirect(node: Extract<AstNode, { type: 'func' }>, resolve: CellResolver, resolveName?: NamedRangeResolver, ctx?: EvalContext): FormulaValue | readonly FormulaValue[] {
  const textArg = node.args[0];
  if (textArg === undefined) return '#REF!';
  const text = scalar(evaluate(textArg, resolve, resolveName, ctx));
  const a1Arg = node.args[1];
  const a1 = a1Arg === undefined ? true : Boolean(scalar(evaluate(a1Arg, resolve, resolveName, ctx)));
  if (typeof text !== 'string' || !a1) return '#REF!';
  const trimmed = text.trim();
  const parsed = parseIndirectRef(trimmed);
  if (parsed === null) {
    // Named ranges work too: INDIRECT("MyName").
    const named = resolveName !== undefined && trimmed !== '' ? resolveName(trimmed) : null;
    if (named === null) return '#REF!';
    return scalar(evaluate(named, resolve, resolveName, ctx));
  }
  const values: FormulaValue[] = [];
  for (let y = parsed.y1; y <= parsed.y2; y += 1) {
    for (let x = parsed.x1; x <= parsed.x2; x += 1) values.push(resolve(x, y, parsed.sheetName));
  }
  const only = values[0];
  return values.length === 1 && only !== undefined ? only : values;
}

/** Excel OFFSET(ref, rows, cols, [height], [width]) — shift a base reference
 * and optionally resize it; single-cell results yield the value, larger ones
 * the flattened row-major array. Out-of-sheet shifts yield '#REF!'. */
function offset(node: Extract<AstNode, { type: 'func' }>, resolve: CellResolver, resolveName?: NamedRangeResolver, ctx?: EvalContext): FormulaValue | readonly FormulaValue[] {
  const [refArg, rowsArg, colsArg, heightArg, widthArg] = node.args;
  if (refArg === undefined || rowsArg === undefined || colsArg === undefined) return '#REF!';
  const ref = unwrapRef(refArg, resolveName);
  if (ref === '#NAME?') return '#NAME?';
  let baseX: number;
  let baseY: number;
  let height = 1;
  let width = 1;
  let sheetName: string | undefined;
  if (ref.type === 'range') {
    baseX = Math.min(ref.x1, ref.x2);
    baseY = Math.min(ref.y1, ref.y2);
    height = Math.abs(ref.y2 - ref.y1) + 1;
    width = Math.abs(ref.x2 - ref.x1) + 1;
    sheetName = ref.sheetName;
  } else if (ref.type === 'cell') {
    baseX = ref.x;
    baseY = ref.y;
    sheetName = ref.sheetName;
  } else {
    return '#VALUE!';
  }
  const rows = Number(scalar(evaluate(rowsArg, resolve, resolveName, ctx)));
  const cols = Number(scalar(evaluate(colsArg, resolve, resolveName, ctx)));
  if (!Number.isFinite(rows) || !Number.isFinite(cols)) return '#VALUE!';
  if (heightArg !== undefined) height = Number(scalar(evaluate(heightArg, resolve, resolveName, ctx)));
  if (widthArg !== undefined) width = Number(scalar(evaluate(widthArg, resolve, resolveName, ctx)));
  if (!Number.isInteger(height) || !Number.isInteger(width) || height < 1 || width < 1) return '#REF!';
  const x1 = baseX + cols;
  const y1 = baseY + rows;
  const x2 = x1 + width - 1;
  const y2 = y1 + height - 1;
  if (x1 < 0 || y1 < 0) return '#REF!';
  if (x1 === x2 && y1 === y2) return resolve(x1, y1, sheetName);
  const values: FormulaValue[] = [];
  for (let y = y1; y <= y2; y += 1) {
    for (let x = x1; x <= x2; x += 1) values.push(resolve(x, y, sheetName));
  }
  return values;
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
function unwrapRef(node: AstNode, resolveName: NamedRangeResolver | undefined): AstNode | '#NAME?' {
  if (node.type !== 'name') return node;
  if (resolveName === undefined) return '#NAME?';
  return resolveName(node.value) ?? '#NAME?';
}

function vlookup(node: Extract<AstNode, { type: 'func' }>, resolve: CellResolver, resolveName?: NamedRangeResolver, ctx?: EvalContext): FormulaValue {
  const [lookupArg, tableArg, colArg, rangeArg] = node.args;
  if (lookupArg === undefined || tableArg === undefined || colArg === undefined) return null;
  const table = unwrapRef(tableArg, resolveName);
  if (table === '#NAME?') return '#NAME?';
  if (table.type !== 'range') return null;
  const lookup = scalar(evaluate(lookupArg, resolve, resolveName, ctx));
  const colIndex = Number(scalar(evaluate(colArg, resolve, resolveName, ctx)));
  const approximate = rangeArg === undefined ? true : Boolean(scalar(evaluate(rangeArg, resolve, resolveName, ctx)));
  const x1 = Math.min(table.x1, table.x2);
  const x2 = Math.max(table.x1, table.x2);
  const y1 = Math.min(table.y1, table.y2);
  const y2 = Math.max(table.y1, table.y2);
  if (!Number.isInteger(colIndex) || colIndex < 1 || colIndex > x2 - x1 + 1) return null;
  let approximateHit: FormulaValue = null;
  for (let y = y1; y <= y2; y += 1) {
    const key = resolve(x1, y, table.sheetName);
    if (excelEquals(key, lookup)) return resolve(x1 + colIndex - 1, y, table.sheetName);
    if (approximate && lookup !== null && key !== null) {
      const order = compare(key, lookup);
      if (order <= 0) approximateHit = resolve(x1 + colIndex - 1, y, table.sheetName);
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
  const table = unwrapRef(tableArg, resolveName);
  if (table === '#NAME?') return '#NAME?';
  if (table.type !== 'range') return null;
  const lookup = scalar(evaluate(lookupArg, resolve, resolveName, ctx));
  const rowIndex = Number(scalar(evaluate(rowArg, resolve, resolveName, ctx)));
  const approximate = rangeArg === undefined ? true : Boolean(scalar(evaluate(rangeArg, resolve, resolveName, ctx)));
  const x1 = Math.min(table.x1, table.x2);
  const x2 = Math.max(table.x1, table.x2);
  const y1 = Math.min(table.y1, table.y2);
  const y2 = Math.max(table.y1, table.y2);
  if (!Number.isInteger(rowIndex) || rowIndex < 1 || rowIndex > y2 - y1 + 1) return null;
  let approximateHit: FormulaValue = null;
  for (let x = x1; x <= x2; x += 1) {
    const key = resolve(x, y1, table.sheetName);
    if (excelEquals(key, lookup)) return resolve(x, y1 + rowIndex - 1, table.sheetName);
    if (approximate && lookup !== null && key !== null) {
      const order = compare(key, lookup);
      if (order <= 0) approximateHit = resolve(x, y1 + rowIndex - 1, table.sheetName);
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
  const lookupArr = unwrapRef(lookupArrArg, resolveName);
  const returnArr = unwrapRef(returnArrArg, resolveName);
  if (lookupArr === '#NAME?' || returnArr === '#NAME?') return '#NAME?';
  if (lookupArr.type !== 'range' || returnArr.type !== 'range') return '#VALUE!';
  const lookup = scalar(evaluate(lookupArg, resolve, resolveName, ctx));
  const matchMode = matchModeArg === undefined ? 0 : Number(scalar(evaluate(matchModeArg, resolve, resolveName, ctx)));
  const searchMode = searchModeArg === undefined ? 1 : Number(scalar(evaluate(searchModeArg, resolve, resolveName, ctx)));
  if (matchMode !== 0 && matchMode !== 2) return '#N/A'; // approximate modes not in this build
  if (searchMode !== 1 && searchMode !== -1) return '#N/A';

  const lx1 = Math.min(lookupArr.x1, lookupArr.x2);
  const lx2 = Math.max(lookupArr.x1, lookupArr.x2);
  const ly1 = Math.min(lookupArr.y1, lookupArr.y2);
  const ly2 = Math.max(lookupArr.y1, lookupArr.y2);
  const rx1 = Math.min(returnArr.x1, returnArr.x2);
  const rx2 = Math.max(returnArr.x1, returnArr.x2);
  const ry1 = Math.min(returnArr.y1, returnArr.y2);
  const ry2 = Math.max(returnArr.y1, returnArr.y2);

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
    const key = resolve(hit.keyX, hit.keyY, lookupArr.sheetName);
    const matched = matchMode === 2
      ? wildcardEquals(key, lookup)
      : excelEquals(key, lookup);
    if (!matched) continue;
    if (lookupIsCol) {
      const retX = rx1; // first return column when multi-col (no spill)
      return resolve(retX, ry1 + hit.index, returnArr.sheetName);
    }
    const retY = ry1;
    return resolve(rx1 + hit.index, retY, returnArr.sheetName);
  }

  if (ifNotFoundArg !== undefined) return scalar(evaluate(ifNotFoundArg, resolve, resolveName, ctx));
  return '#N/A';
}

/** INDEX(ref, row, [col]). Row/col are 1-based. A single-row range treats the second arg as the column. */
function indexFn(node: Extract<AstNode, { type: 'func' }>, resolve: CellResolver, resolveName?: NamedRangeResolver, ctx?: EvalContext): FormulaValue {
  const [arrArg, rowArg, colArg] = node.args;
  if (arrArg === undefined || rowArg === undefined) return '#VALUE!';
  const ref = unwrapRef(arrArg, resolveName);
  if (ref === '#NAME?') return '#NAME?';
  const rowNum = Number(scalar(evaluate(rowArg, resolve, resolveName, ctx)));
  const colNum = colArg === undefined ? undefined : Number(scalar(evaluate(colArg, resolve, resolveName, ctx)));
  if (!Number.isFinite(rowNum) || (colNum !== undefined && !Number.isFinite(colNum))) return '#VALUE!';
  if (ref.type === 'cell') {
    if (rowNum === 1 && (colNum === undefined || colNum === 1)) return resolve(ref.x, ref.y, ref.sheetName);
    return '#REF!';
  }
  if (ref.type !== 'range') return '#VALUE!';
  const x1 = Math.min(ref.x1, ref.x2);
  const x2 = Math.max(ref.x1, ref.x2);
  const y1 = Math.min(ref.y1, ref.y2);
  const y2 = Math.max(ref.y1, ref.y2);
  const rows = y2 - y1 + 1;
  const cols = x2 - x1 + 1;
  let r = rowNum;
  const c = colNum ?? (rows === 1 ? rowNum : 1);
  if (colNum === undefined && rows === 1) r = 1;
  if (!Number.isInteger(r) || !Number.isInteger(c) || r < 1 || c < 1 || r > rows || c > cols) return '#REF!';
  return resolve(x1 + c - 1, y1 + r - 1, ref.sheetName);
}

/** MATCH(lookup, ref, [type]). 1 = ascending approximate (default), 0 = exact, -1 = descending. Miss is #N/A. */
function matchFn(node: Extract<AstNode, { type: 'func' }>, resolve: CellResolver, resolveName?: NamedRangeResolver, ctx?: EvalContext): FormulaValue {
  const [searchArg, arrArg, typeArg] = node.args;
  if (searchArg === undefined || arrArg === undefined) return '#N/A';
  const search = scalar(evaluate(searchArg, resolve, resolveName, ctx));
  const searchErr = errorValueOf(search);
  if (searchErr !== undefined) return searchErr;
  const matchType = typeArg === undefined ? 1 : Number(scalar(evaluate(typeArg, resolve, resolveName, ctx)));
  if (matchType !== 1 && matchType !== 0 && matchType !== -1) return '#VALUE!';
  const values = refValues(arrArg, resolve, resolveName, ctx);
  if (typeof values === 'string') return values;
  if (matchType === 0) {
    const exact = values.findIndex((entry) => excelEquals(entry, search));
    return exact < 0 ? '#N/A' : exact + 1;
  }
  let hit = -1;
  for (let i = 0; i < values.length; i += 1) {
    const entry = values[i] ?? null;
    if (entry === null) continue;
    if (excelEquals(entry, search)) return i + 1;
    const order = compare(entry, search);
    if (matchType === 1 ? order < 0 : order > 0) hit = i;
    else break;
  }
  return hit < 0 ? '#N/A' : hit + 1;
}

function refValues(node: AstNode, resolve: CellResolver, resolveName: NamedRangeResolver | undefined, ctx: EvalContext | undefined): FormulaValue[] | string {
  const ref = unwrapRef(node, resolveName);
  if (ref === '#NAME?') return '#NAME?';
  if (ref.type === 'cell') return [resolve(ref.x, ref.y, ref.sheetName)];
  if (ref.type === 'range') {
    const values: FormulaValue[] = [];
    const x1 = Math.min(ref.x1, ref.x2);
    const x2 = Math.max(ref.x1, ref.x2);
    const y1 = Math.min(ref.y1, ref.y2);
    const y2 = Math.max(ref.y1, ref.y2);
    for (let y = y1; y <= y2; y += 1) {
      for (let x = x1; x <= x2; x += 1) values.push(resolve(x, y, ref.sheetName));
    }
    return values;
  }
  const evaluated = evaluate(ref, resolve, resolveName, ctx);
  return isFormulaList(evaluated) ? [...evaluated] : [scalar(evaluated)];
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

function evaluateBinary(node: Extract<AstNode, { type: 'binary' }>, resolve: CellResolver, resolveName?: NamedRangeResolver, ctx?: EvalContext): FormulaArgument {
  const left = evaluate(node.left, resolve, resolveName, ctx);
  const right = evaluate(node.right, resolve, resolveName, ctx);

  // Excel array math: when either operand is a range/array, the operator maps
  // element-wise (SUMPRODUCT((B1:B3="a")*(A1:A3)) and friends). A scalar side
  // broadcasts to every element; two lists of different lengths run to the
  // longer one with blanks (null) filling the shorter side.
  if (isFormulaList(left) || isFormulaList(right)) {
    const l = isFormulaList(left);
    const r = isFormulaList(right);
    const lList = l ? left : ([] as unknown as readonly FormulaValue[]);
    const rList = r ? right : ([] as unknown as readonly FormulaValue[]);
    const len = Math.max(l ? left.length : 1, r ? right.length : 1);
    const out: FormulaValue[] = new Array(len);
    for (let i = 0; i < len; i += 1) {
      const lv = (l ? lList[i] ?? null : left) as FormulaValue;
      const rv = (r ? rList[i] ?? null : right) as FormulaValue;
      out[i] = binaryScalar(node.op, lv, rv);
    }
    return out;
  }
  return binaryScalar(node.op, left, right);
}

function binaryScalar(op: string, left: FormulaValue, right: FormulaValue): FormulaValue {
  // Excel error values ('#DIV/0!', '#N/A', …) propagate through arithmetic.
  const leftError = errorValueOf(left);
  if (leftError !== undefined) return leftError;
  const rightError = errorValueOf(right);
  if (rightError !== undefined) return rightError;

  switch (op) {
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
