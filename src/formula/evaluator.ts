import { EXCEL_ERRORS, isExcelError, isMatrix, isSparseRange, matrix, type MatrixValue, type SparseRangeValue } from './types';
import { MAX_DENSE_RANGE_CELLS } from '../util/limits';
import { FormulaParser } from './parser';
import { halvesToRect, parseRefHalf } from './precedents';
import { registry, type FunctionContext, type FunctionRegistry } from './registry';
import type { AstNode, CellResolver, FormulaArgument, FormulaValue } from './types';

/** The Excel error literals; the table itself lives in types.ts (the single source). */
export { EXCEL_ERRORS } from './types';

/** How Excel shows a formula result that is a date: the day, or the day with its time. */
export type DateResult = 'date' | 'datetime';

/**
 * 'date' / 'datetime' when a formula's own result is a date value, which
 * Excel displays as one even under the General format: TODAY() and DATE(…)
 * give the day, NOW() the day with its time, and a number of days added to or
 * taken from either stays a date (=TODAY()+1). The difference of two dates is
 * a plain number of days, and so is everything else — a reference to a date
 * cell included, since that depends on the cell rather than the formula.
 */
export function dateResultOf(node: AstNode): DateResult | undefined {
  switch (node.type) {
    case 'func':
      if (node.name === 'TODAY' || node.name === 'DATE') return 'date';
      return node.name === 'NOW' ? 'datetime' : undefined;
    case 'unary':
      return dateResultOf(node.operand);
    case 'binary': {
      if (node.op !== '+' && node.op !== '-') return undefined;
      const left = dateResultOf(node.left);
      const right = dateResultOf(node.right);
      return left === undefined ? right : (right === undefined ? left : undefined);
    }
    default:
      return undefined;
  }
}

/** A formula that could have a date result at all — spares parsing the others. */
const HAS_DATE_FUNCTION = /(^|[^A-Za-z0-9_.])(TODAY|NOW|DATE)\s*\(/i;

/** {@link dateResultOf} for a formula's text (`=TODAY()`); undefined when it is no formula. */
export function dateResultOfFormula(formula: string | undefined): DateResult | undefined {
  if (formula === undefined || !HAS_DATE_FUNCTION.test(formula)) return undefined;
  const ast = new FormulaParser().parse(formula);
  return ast === null ? undefined : dateResultOf(ast);
}

export type NamedRangeResolver = (name: string) => AstNode | null;

/** Optional evaluation context (row visibility for SUBTOTAL, etc.). */
export interface EvalContext {
  readonly isRowHidden?: (row: number, sheetName?: string) => boolean;
  /** The cell the formula lives in — ROW()/COLUMN() without args (Excel). */
  readonly currentCell?: { readonly r: number; readonly c: number };
  /** The sheet `currentCell` sits on; the engine passes the evaluated formula's own sheet. */
  readonly sheetId?: string;
  /**
   * Called when the evaluation reaches a call to a volatile function
   * (FunctionSpec.volatile). The engine uses it to remember which formulas
   * must re-evaluate on every recalculation pass that has other work.
   */
  readonly onVolatileCall?: () => void;
  /**
   * Function table to resolve names against; the shared `registry` when
   * omitted. The formula engine passes its own, so an engine with a private
   * table never sees another engine's functions.
   */
  readonly registry?: FunctionRegistry;
  /**
   * Calls `fn(x, y)` for every stored cell of the rectangle, on the sheet
   * named by the reference. Absent for bare evaluate() calls (conditional
   * formats, validation rules), which keep the address-by-address behavior.
   * Never walks empty addresses: a range over a million-row column costs its
   * stored cells, not its area.
   */
  readonly forEachStoredCell?: (
    rect: { x1: number; y1: number; x2: number; y2: number },
    sheetName: string | undefined,
    fn: (x: number, y: number) => void,
  ) => void;
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
      return evaluateRange(node, resolve, ctx);
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

/**
 * A range reference as a value. Up to {@link MAX_DENSE_RANGE_CELLS} it is the
 * row-major dense list it always was (blanks as `null`) — but with a stored-
 * cell walk available only the stored cells are resolved, each written into
 * its position. Above that ceiling the dense list is not allocated: the value
 * is a {@link SparseRangeValue} the aggregates consume cell by cell. Without
 * a walk (bare evaluate calls) the address loop stays, so conditional-format
 * and validation rules behave exactly as before.
 */
function evaluateRange(node: Extract<AstNode, { type: 'range' }>, resolve: CellResolver, ctx?: EvalContext): FormulaArgument {
  const x1 = Math.min(node.x1, node.x2);
  const x2 = Math.max(node.x1, node.x2);
  const y1 = Math.min(node.y1, node.y2);
  const y2 = Math.max(node.y1, node.y2);
  const cols = x2 - x1 + 1;
  const area = (y2 - y1 + 1) * cols;
  const walk = ctx?.forEachStoredCell;
  if (walk === undefined) {
    const values: FormulaValue[] = [];
    for (let y = y1; y <= y2; y += 1) {
      for (let x = x1; x <= x2; x += 1) values.push(resolve(x, y, node.sheetName));
    }
    return values;
  }
  // A reference to a sheet that does not exist resolves '#REF!' at every
  // address; the walk would visit none of them, so probe the first one.
  if (node.sheetName !== undefined && resolve(x1, y1, node.sheetName) === '#REF!') return '#REF!';
  if (area > MAX_DENSE_RANGE_CELLS) return makeSparseRange(x1, y1, x2, y2, node.sheetName, resolve, walk);
  const values: FormulaValue[] = new Array(area).fill(null);
  walk({ x1, y1, x2, y2 }, node.sheetName, (x, y) => {
    values[(y - y1) * cols + (x - x1)] = resolve(x, y, node.sheetName);
  });
  return values;
}

/** The sparse stand-in for a rectangle too large to materialise. */
function makeSparseRange(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  sheetName: string | undefined,
  resolve: CellResolver,
  walk: NonNullable<EvalContext['forEachStoredCell']>,
): SparseRangeValue {
  const rows = y2 - y1 + 1;
  const cols = x2 - x1 + 1;
  return {
    __sparse: true,
    left: x1,
    top: y1,
    rows,
    cols,
    area: rows * cols,
    forEachStored: (fn) => {
      walk({ x1, y1, x2, y2 }, sheetName, (x, y) => fn(resolve(x, y, sheetName), y, x));
    },
  };
}

/**
 * Values of a rectangle address by address (INDIRECT / OFFSET results): the
 * dense row-major list up to {@link MAX_DENSE_RANGE_CELLS}, a sparse range
 * value above it. A reference to a missing sheet stays one '#REF!'.
 */
function rectValues(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  sheetName: string | undefined,
  resolve: CellResolver,
  ctx: EvalContext | undefined,
): FormulaArgument {
  const area = (y2 - y1 + 1) * (x2 - x1 + 1);
  const walk = ctx?.forEachStoredCell;
  if (walk === undefined || area <= MAX_DENSE_RANGE_CELLS) {
    const values: FormulaValue[] = [];
    for (let y = y1; y <= y2; y += 1) {
      for (let x = x1; x <= x2; x += 1) values.push(resolve(x, y, sheetName));
    }
    return values;
  }
  if (sheetName !== undefined && resolve(x1, y1, sheetName) === '#REF!') return '#REF!';
  return makeSparseRange(x1, y1, x2, y2, sheetName, resolve, walk);
}

/** Stored cells of a sparse range as the flat list the value-aggregates take. */
function materializeStored(value: SparseRangeValue): FormulaValue[] {
  const out: FormulaValue[] = [];
  value.forEachStored((v) => { out.push(v); });
  return out;
}

function evaluateFunction(
  node: Extract<AstNode, { type: 'func' }>,
  resolve: CellResolver,
  resolveName?: NamedRangeResolver,
  ctx?: EvalContext,
): FormulaArgument {
  const spec = (ctx?.registry ?? registry).get(node.name);
  const arity = spec === undefined ? LOCAL_ARITY[node.name] : spec;
  if (arity === undefined) return '#NAME?';
  // The declared arity is the contract: a call outside it is an error value,
  // never a silently wrong answer (=SUM() used to read as 0).
  if (node.args.length < arity.minArgs || node.args.length > arity.maxArgs) return '#VALUE!';

  // A volatile call (FunctionSpec.volatile, e.g. NOW / TODAY) is reported to
  // the engine at encounter, before its arguments evaluate, so the calling
  // formula stays marked however its arguments turn out this pass.
  if (spec?.volatile === true) ctx?.onVolatileCall?.();

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
  // UNIQUE / SORT / FILTER work on a table: a range reference keeps its
  // row/column extent for them (it reaches other functions as a flat list).
  const tabular = TABLE_ARG.has(node.name);
  let args = node.args.map((arg) => {
    const value = evaluate(arg, resolve, resolveName, ctx);
    const shape = tabular ? shapeOfOperand(arg, value, resolveName) : undefined;
    return shape === undefined || isMatrix(value) ? value : matrix(shape.rows, shape.cols, value as readonly FormulaValue[]);
  });
  // A sparse range reaches the value-aggregates as the flat list of its
  // stored cells — materialised before the error gate so the stored walk
  // happens once per argument.
  if (SPARSE_VALUES_OK.has(node.name)) {
    args = args.map((arg) => (isSparseRange(arg) ? materializeStored(arg) : arg));
  }
  // Excel: most functions propagate error args; IS* inspect them instead.
  if (!ERROR_INSPECTING.has(node.name)) {
    for (const arg of args) {
      const err = firstErrorIn(arg);
      if (err !== undefined) return err;
    }
  }
  // Everything that needs an index into a range or its full grid — INDEX,
  // the lookups, UNIQUE/SORT/FILTER, matrix arithmetic — refuses a range
  // too large to materialise ('#VALUE!') instead of walking the address space.
  if (args.some(isSparseRange) && !SPARSE_SUPPORTS.has(node.name)) return '#VALUE!';
  // Which cell/sheet the calling formula lives in. The engine path always
  // supplies currentCell and sheetId; a bare evaluate() call (conditional-
  // format / validation rules) supplies neither, so ctx-aware functions
  // receive undefined there instead of invented coordinates.
  const fnCtx: FunctionContext | undefined =
    ctx?.currentCell === undefined || ctx.sheetId === undefined
      ? undefined
      : { cell: ctx.currentCell, sheetId: ctx.sheetId };
  return spec === undefined ? '#NAME?' : guardNumeric(spec.evaluate(args, fnCtx));
}

/**
 * Arity of the functions evaluated in this file instead of through the
 * registry. IF / INDEX / MATCH also have a registry entry, which wins above.
 * IFERROR / IFNA keep their fallback optional (blank on error) as before.
 */
const LOCAL_ARITY: Readonly<Record<string, { readonly minArgs: number; readonly maxArgs: number }>> = {
  IFS: { minArgs: 2, maxArgs: 254 }, SWITCH: { minArgs: 3, maxArgs: 254 },
  IFERROR: { minArgs: 1, maxArgs: 2 }, IFNA: { minArgs: 1, maxArgs: 2 },
  INDIRECT: { minArgs: 1, maxArgs: 2 }, OFFSET: { minArgs: 3, maxArgs: 5 },
  ROW: { minArgs: 0, maxArgs: 1 }, COLUMN: { minArgs: 0, maxArgs: 1 }, ROWS: { minArgs: 1, maxArgs: 1 }, COLUMNS: { minArgs: 1, maxArgs: 1 },
  SUBTOTAL: { minArgs: 2, maxArgs: 254 }, VLOOKUP: { minArgs: 3, maxArgs: 4 }, HLOOKUP: { minArgs: 3, maxArgs: 4 },
  XLOOKUP: { minArgs: 3, maxArgs: 6 },
};

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

/** Parse the text accepted by INDIRECT: [Sheet!]A1, [Sheet!]A1:B2, and the
 * whole-column / whole-row forms ([Sheet!]A:B, [Sheet!]3:5) — [$] anchors
 * allowed; quoted sheet names with spaces supported. */
function parseIndirectRef(text: string): { sheetName?: string | undefined; x1: number; y1: number; x2: number; y2: number } | null {
  const match = text.match(/^(?:(?:'((?:[^']|'')+)'|([A-Za-z0-9_\u4e00-\u9fff]+))!)?\s*([^:]+?)(?:\s*:\s*([^:]+?))?\s*$/u);
  const sheetName = match?.[1] !== undefined ? match[1].replace(/''/g, "'") : match?.[2];
  const startText = match?.[3];
  if (startText === undefined) return null;
  const from = parseRefHalf(startText.trim().replaceAll('$', ''));
  if (from === null) return null;
  const endText = match?.[4];
  let rect;
  if (endText === undefined) {
    // A lone reference must name one whole cell.
    if (from.col === undefined || from.row === undefined) return null;
    rect = { r1: from.row, c1: from.col, r2: from.row, c2: from.col };
  } else {
    const to = parseRefHalf(endText.trim().replaceAll('$', ''));
    if (to === null) return null;
    const built = halvesToRect(from, to);
    if (built === null) return null;
    rect = built;
  }
  return { sheetName, x1: rect.c1, y1: rect.r1, x2: rect.c2, y2: rect.r2 };
}

/** Excel INDIRECT(ref_text, [a1]) — resolve a text reference against the sheet.
 * R1C1 style (a1 = FALSE) is not supported and yields '#REF!'. */
function indirect(node: Extract<AstNode, { type: 'func' }>, resolve: CellResolver, resolveName?: NamedRangeResolver, ctx?: EvalContext): FormulaArgument {
  const textArg = node.args[0];
  if (textArg === undefined) return '#REF!';
  const text = scalar(evaluate(textArg, resolve, resolveName, ctx));
  const a1Arg = node.args[1];
  const a1Value = a1Arg === undefined ? undefined : scalar(evaluate(a1Arg, resolve, resolveName, ctx));
  const argErr = errorAmong(text, a1Value);
  if (argErr !== undefined) return argErr;
  const a1 = a1Value === undefined ? true : Boolean(a1Value);
  if (typeof text !== 'string' || !a1) return '#REF!';
  const trimmed = text.trim();
  const parsed = parseIndirectRef(trimmed);
  if (parsed === null) {
    // Named ranges work too: INDIRECT("MyName").
    const named = resolveName !== undefined && trimmed !== '' ? resolveName(trimmed) : null;
    if (named === null) return '#REF!';
    return scalar(evaluate(named, resolve, resolveName, ctx));
  }
  const values = rectValues(parsed.x1, parsed.y1, parsed.x2, parsed.y2, parsed.sheetName, resolve, ctx);
  if (isSparseRange(values)) return values;
  if (!isFormulaList(values)) return values; // a '#REF!' from an unresolvable sheet
  const only = values[0];
  return values.length === 1 && only !== undefined ? only : values;
}

/** Excel OFFSET(ref, rows, cols, [height], [width]) — shift a base reference
 * and optionally resize it; single-cell results yield the value, larger ones
 * the flattened row-major array. Out-of-sheet shifts yield '#REF!'. */
function offset(node: Extract<AstNode, { type: 'func' }>, resolve: CellResolver, resolveName?: NamedRangeResolver, ctx?: EvalContext): FormulaArgument {
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
  const rowsValue = scalar(evaluate(rowsArg, resolve, resolveName, ctx));
  const colsValue = scalar(evaluate(colsArg, resolve, resolveName, ctx));
  const heightValue = heightArg === undefined ? undefined : scalar(evaluate(heightArg, resolve, resolveName, ctx));
  const widthValue = widthArg === undefined ? undefined : scalar(evaluate(widthArg, resolve, resolveName, ctx));
  const argErr = errorAmong(rowsValue, colsValue, heightValue, widthValue);
  if (argErr !== undefined) return argErr;
  const rows = Number(rowsValue);
  const cols = Number(colsValue);
  if (!Number.isFinite(rows) || !Number.isFinite(cols)) return '#VALUE!';
  if (heightValue !== undefined) height = Number(heightValue);
  if (widthValue !== undefined) width = Number(widthValue);
  if (!Number.isInteger(height) || !Number.isInteger(width) || height < 1 || width < 1) return '#REF!';
  const x1 = baseX + cols;
  const y1 = baseY + rows;
  const x2 = x1 + width - 1;
  const y2 = y1 + height - 1;
  if (x1 < 0 || y1 < 0) return '#REF!';
  if (x1 === x2 && y1 === y2) return resolve(x1, y1, sheetName);
  return rectValues(x1, y1, x2, y2, sheetName, resolve, ctx);
}

function firstErrorIn(value: FormulaArgument): string | undefined {
  if (isFormulaList(value)) {
    // Index loop over what may be a million-entry dense range.
    for (let i = 0; i < value.length; i += 1) {
      const entry = value[i];
      if (typeof entry === 'string' && EXCEL_ERRORS.has(entry)) return entry;
    }
    return undefined;
  }
  if (isMatrix(value)) {
    // Errors anywhere in a matrix propagate, not just at [0] — scalar() would
    // mask an #N/A in the second row of a spilled vector.
    for (const entry of value.data) {
      const err = errorValueOf(entry);
      if (err !== undefined) return err;
    }
    return undefined;
  }
  if (isSparseRange(value)) {
    // Same rule over stored cells only; blanks are never errors.
    let found: string | undefined;
    value.forEachStored((entry) => {
      if (found === undefined) found = errorValueOf(entry);
    });
    return found;
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
  const colValue = scalar(evaluate(colArg, resolve, resolveName, ctx));
  const rangeValue = rangeArg === undefined ? undefined : scalar(evaluate(rangeArg, resolve, resolveName, ctx));
  // VLOOKUP(#REF!, …) is #REF!, not "no match".
  const argErr = errorAmong(lookup, colValue, rangeValue);
  if (argErr !== undefined) return argErr;
  const colIndex = Number(colValue);
  const approximate = rangeValue === undefined ? true : Boolean(rangeValue);
  const x1 = Math.min(table.x1, table.x2);
  const x2 = Math.max(table.x1, table.x2);
  const y1 = Math.min(table.y1, table.y2);
  const y2 = Math.max(table.y1, table.y2);
  if (!Number.isInteger(colIndex) || colIndex < 1 || colIndex > x2 - x1 + 1) return null;
  let approximateHit: FormulaValue = null;
  // A table beyond the dense ceiling is walked stored cell by stored cell
  // (whole-column lookups stay O(stored), not O(rows)); the walk is in row
  // order, so the approximate scan sees the keys in the order the dense loop
  // would.
  const walk = ctx?.forEachStoredCell;
  if ((y2 - y1 + 1) * (x2 - x1 + 1) > MAX_DENSE_RANGE_CELLS && walk !== undefined) {
    if (table.sheetName !== undefined && resolve(x1, y1, table.sheetName) === '#REF!') return '#REF!';
    const valueX = x1 + colIndex - 1;
    let hit: FormulaValue | undefined;
    let best: FormulaValue | undefined;
    walk({ x1, y1, x2, y2 }, table.sheetName, (x, y) => {
      if (x !== x1) return; // the key column decides; value cells are read per hit
      const key = resolve(x, y, table.sheetName);
      if (excelEquals(key, lookup)) {
        if (hit === undefined) hit = resolve(valueX, y, table.sheetName);
        return;
      }
      // Ascending keys: the last key ≤ the lookup is the approximate hit —
      // the same answer the dense loop reaches before it breaks.
      if (approximate && lookup !== null && key !== null && compare(key, lookup) <= 0) {
        best = resolve(valueX, y, table.sheetName);
      }
    });
    if (hit !== undefined) return hit;
    return approximate ? (best ?? '#N/A') : '#N/A';
  }
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
  const rowValue = scalar(evaluate(rowArg, resolve, resolveName, ctx));
  const rangeValue = rangeArg === undefined ? undefined : scalar(evaluate(rangeArg, resolve, resolveName, ctx));
  const argErr = errorAmong(lookup, rowValue, rangeValue);
  if (argErr !== undefined) return argErr;
  const rowIndex = Number(rowValue);
  const approximate = rangeValue === undefined ? true : Boolean(rangeValue);
  const x1 = Math.min(table.x1, table.x2);
  const x2 = Math.max(table.x1, table.x2);
  const y1 = Math.min(table.y1, table.y2);
  const y2 = Math.max(table.y1, table.y2);
  if (!Number.isInteger(rowIndex) || rowIndex < 1 || rowIndex > y2 - y1 + 1) return null;
  let approximateHit: FormulaValue = null;
  // Same stored-cell walk as VLOOKUP for tables beyond the dense ceiling.
  const walk = ctx?.forEachStoredCell;
  if ((y2 - y1 + 1) * (x2 - x1 + 1) > MAX_DENSE_RANGE_CELLS && walk !== undefined) {
    if (table.sheetName !== undefined && resolve(x1, y1, table.sheetName) === '#REF!') return '#REF!';
    const valueY = y1 + rowIndex - 1;
    let hit: FormulaValue | undefined;
    let best: FormulaValue | undefined;
    walk({ x1, y1, x2, y2 }, table.sheetName, (x, y) => {
      if (y !== y1) return;
      const key = resolve(x, y, table.sheetName);
      if (excelEquals(key, lookup)) {
        if (hit === undefined) hit = resolve(x, valueY, table.sheetName);
        return;
      }
      if (approximate && lookup !== null && key !== null && compare(key, lookup) <= 0) {
        best = resolve(x, valueY, table.sheetName);
      }
    });
    if (hit !== undefined) return hit;
    return approximate ? (best ?? '#N/A') : '#N/A';
  }
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
 * Multi-cell return arrays spill the aligned vector (MatrixValue).
 */
function xlookup(node: Extract<AstNode, { type: 'func' }>, resolve: CellResolver, resolveName?: NamedRangeResolver, ctx?: EvalContext): FormulaValue | MatrixValue {
  const [lookupArg, lookupArrArg, returnArrArg, ifNotFoundArg, matchModeArg, searchModeArg] = node.args;
  if (lookupArg === undefined || lookupArrArg === undefined || returnArrArg === undefined) return null;
  const lookupArr = unwrapRef(lookupArrArg, resolveName);
  const returnArr = unwrapRef(returnArrArg, resolveName);
  if (lookupArr === '#NAME?' || returnArr === '#NAME?') return '#NAME?';
  if (lookupArr.type !== 'range' || returnArr.type !== 'range') return '#VALUE!';
  const lookup = scalar(evaluate(lookupArg, resolve, resolveName, ctx));
  const matchModeValue = matchModeArg === undefined ? 0 : scalar(evaluate(matchModeArg, resolve, resolveName, ctx));
  const searchModeValue = searchModeArg === undefined ? 1 : scalar(evaluate(searchModeArg, resolve, resolveName, ctx));
  const argErr = errorAmong(lookup, matchModeValue, searchModeValue);
  if (argErr !== undefined) return argErr;
  const matchMode = Number(matchModeValue);
  const searchMode = Number(searchModeValue);
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
  // Indexed access on both arrays: beyond the dense ceiling there is no array.
  if ((ly2 - ly1 + 1) * (lx2 - lx1 + 1) > MAX_DENSE_RANGE_CELLS) return '#VALUE!';
  if ((ry2 - ry1 + 1) * (rx2 - rx1 + 1) > MAX_DENSE_RANGE_CELLS) return '#VALUE!';

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
      // Multi-column return_array spills a row vector (Excel dynamic arrays).
      if (rx2 > rx1) {
        const row: FormulaValue[] = [];
        for (let x = rx1; x <= rx2; x += 1) row.push(resolve(x, ry1 + hit.index, returnArr.sheetName));
        return matrix(1, row.length, row);
      }
      return resolve(rx1, ry1 + hit.index, returnArr.sheetName);
    }
    // Lookup along a row: a multi-row return_array spills a column vector.
    if (ry2 > ry1) {
      const col: FormulaValue[] = [];
      for (let y = ry1; y <= ry2; y += 1) col.push(resolve(rx1 + hit.index, y, returnArr.sheetName));
      return matrix(col.length, 1, col);
    }
    return resolve(rx1 + hit.index, ry1, returnArr.sheetName);
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
  const rowValue = scalar(evaluate(rowArg, resolve, resolveName, ctx));
  const colValue = colArg === undefined ? undefined : scalar(evaluate(colArg, resolve, resolveName, ctx));
  const argErr = errorAmong(rowValue, colValue);
  if (argErr !== undefined) return argErr;
  const rowNum = Number(rowValue);
  const colNum = colValue === undefined ? undefined : Number(colValue);
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
  const matchTypeValue = typeArg === undefined ? undefined : scalar(evaluate(typeArg, resolve, resolveName, ctx));
  const typeErr = errorValueOf(matchTypeValue);
  if (typeErr !== undefined) return typeErr;
  const matchType = matchTypeValue === undefined ? 1 : Number(matchTypeValue);
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
    if ((y2 - y1 + 1) * (x2 - x1 + 1) > MAX_DENSE_RANGE_CELLS) return '#VALUE!'; // MATCH needs positions
    for (let y = y1; y <= y2; y += 1) {
      for (let x = x1; x <= x2; x += 1) values.push(resolve(x, y, ref.sheetName));
    }
    return values;
  }
  const evaluated = evaluate(ref, resolve, resolveName, ctx);
  // A matrix (a sorted / filtered / computed array) is a whole lookup column too.
  if (isMatrix(evaluated)) return [...evaluated.data];
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
  const fnValue = scalar(evaluate(fnArg, resolve, resolveName, ctx));
  const fnErr = errorValueOf(fnValue);
  if (fnErr !== undefined) return fnErr;
  const rawFn = Number(fnValue);
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
      const area = (y2 - y1 + 1) * (x2 - x1 + 1);
      const walk = ctx?.forEachStoredCell;
      // A range beyond the dense ceiling (SUBTOTAL(A:A, …)) is walked stored
      // cell by stored cell — blank addresses add nothing to any of the 11
      // operations, and the hidden-row test still runs per visited row.
      if (area > MAX_DENSE_RANGE_CELLS && walk !== undefined) {
        if (arg.sheetName !== undefined && resolve(x1, y1, arg.sheetName) === '#REF!') return '#REF!';
        walk({ x1, y1, x2, y2 }, arg.sheetName, (x, y) => {
          if (ctx?.isRowHidden?.(y, arg.sheetName) === true) return;
          values.push(resolve(x, y, arg.sheetName));
        });
        continue;
      }
      for (let y = y1; y <= y2; y += 1) {
        if (ctx?.isRowHidden?.(y, arg.sheetName) === true) continue;
        for (let x = x1; x <= x2; x += 1) values.push(resolve(x, y, arg.sheetName));
      }
    } else {
      const v = evaluate(arg, resolve, resolveName, ctx);
      if (isMatrix(v)) values.push(...v.data);
      else if (isFormulaList(v)) values.push(...v);
      else if (isSparseRange(v)) v.forEachStored((entry) => values.push(entry));
      else values.push(v);
    }
  }

  // Like SUM and friends, an error in a counted row propagates (hidden rows were skipped above).
  for (const v of values) {
    const err = errorValueOf(v);
    if (err !== undefined) return err;
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
      return nums.length === 0 ? 0 : nums.reduce((a, b) => Math.max(a, b));
    case 5: // MIN
      return nums.length === 0 ? 0 : nums.reduce((a, b) => Math.min(a, b));
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

interface Shape { readonly rows: number; readonly cols: number }

/**
 * Row/column extent of an operand that is an array. A matrix carries it; a
 * range reference (or a name standing for one) is read from its corners; any
 * other list (INDIRECT / OFFSET output) is taken for a column vector. A
 * scalar has none.
 */
function shapeOfOperand(node: AstNode, value: FormulaArgument, resolveName: NamedRangeResolver | undefined): Shape | undefined {
  if (isMatrix(value)) return value;
  if (!isFormulaList(value)) return undefined;
  const ref = node.type === 'name' ? unwrapRef(node, resolveName) : node;
  if (ref !== '#NAME?' && ref.type === 'range') return { rows: Math.abs(ref.y2 - ref.y1) + 1, cols: Math.abs(ref.x2 - ref.x1) + 1 };
  return { rows: value.length, cols: 1 };
}

/** Element of an array operand at (y, x); a scalar or a one-row / one-column operand repeats itself. */
function elementOf(value: FormulaArgument, shape: Shape | undefined, y: number, x: number): FormulaValue {
  if (shape === undefined) return value as FormulaValue;
  const data = isMatrix(value) ? value.data : (value as readonly FormulaValue[]);
  return data[(shape.rows === 1 ? 0 : y) * shape.cols + (shape.cols === 1 ? 0 : x)] ?? null;
}

function evaluateBinary(node: Extract<AstNode, { type: 'binary' }>, resolve: CellResolver, resolveName?: NamedRangeResolver, ctx?: EvalContext): FormulaArgument {
  const left = evaluate(node.left, resolve, resolveName, ctx);
  const right = evaluate(node.right, resolve, resolveName, ctx);
  // Array math maps element-wise over a materialised grid; a range too large
  // to materialise has no grid to map over.
  if (isSparseRange(left) || isSparseRange(right)) return '#VALUE!';
  const leftShape = shapeOfOperand(node.left, left, resolveName);
  const rightShape = shapeOfOperand(node.right, right, resolveName);
  if (leftShape === undefined && rightShape === undefined) {
    return binaryScalar(node.op, left as FormulaValue, right as FormulaValue);
  }
  // Excel array math (SUMPRODUCT((B1:B3="a")*(A1:A3)) and friends): the
  // operator maps element-wise and the result keeps the array's shape as a
  // matrix, so =SEQUENCE(3)*2 spills 2;4;6. A scalar — or a one-row /
  // one-column array — broadcasts against the other operand; the result is as
  // tall and as wide as the larger side on each axis. Arrays that cannot be
  // lined up that way are '#N/A', like Excel.
  const rows = Math.max(leftShape?.rows ?? 1, rightShape?.rows ?? 1);
  const cols = Math.max(leftShape?.cols ?? 1, rightShape?.cols ?? 1);
  const fits = (s: Shape | undefined): boolean => s === undefined || ((s.rows === rows || s.rows === 1) && (s.cols === cols || s.cols === 1));
  if (rows < 1 || cols < 1 || !fits(leftShape) || !fits(rightShape)) return '#N/A';
  const out: FormulaValue[] = new Array(rows * cols);
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      out[y * cols + x] = binaryScalar(node.op, elementOf(left, leftShape, y, x), elementOf(right, rightShape, y, x));
    }
  }
  return rows === 1 && cols === 1 ? out[0] ?? null : matrix(rows, cols, out);
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

/** Functions that inspect a value's error/blank/type status rather than compute with it. */
const ERROR_INSPECTING: ReadonlySet<string> = new Set([
  'ISERROR', 'ISERR', 'ISNA', 'ISBLANK', 'ISNUMBER', 'ISTEXT', 'ISLOGICAL', 'ISNONTEXT',
]);

/** Functions whose range arguments keep their two-dimensional extent. */
const TABLE_ARG: ReadonlySet<string> = new Set(['UNIQUE', 'SORT', 'FILTER']);

/** Sparse-capable functions that just flatten their arguments into one bag of values. */
const SPARSE_VALUES_OK: ReadonlySet<string> = new Set([
  'SUM', 'AVERAGE', 'MAX', 'MIN', 'COUNT', 'COUNTA', 'PRODUCT', 'MEDIAN',
  'LARGE', 'SMALL', 'STDEV', 'STDEVP', 'STDEV.S', 'STDEV.P',
  'TEXTJOIN', 'CONCAT', 'CONCATENATE', 'RANK', 'RANK.EQ',
]);

/**
 * Functions that may receive a range too large to materialise: they read it
 * as a bag of its stored cells (aggregates, where argument order among
 * themselves is irrelevant), walk it positionally (the criteria family,
 * which align a sum range to a criteria range by relative offset — COUNTIF
 * needs the area to answer blank-matching criteria arithmetically), or
 * consume the sparse value directly (COUNTBLANK, AND/OR, SUBTOTAL).
 */
const SPARSE_SUPPORTS: ReadonlySet<string> = new Set([
  ...SPARSE_VALUES_OK,
  'COUNTBLANK', 'AND', 'OR', 'COUNTIF',
  'SUMIF', 'SUMIFS', 'COUNTIFS', 'AVERAGEIF', 'AVERAGEIFS', 'MAXIFS', 'MINIFS',
  'SUMPRODUCT', 'SUBTOTAL',
]);

/** A cell/formula value that is itself an Excel error literal ('#DIV/0!', '#N/A', '#API!', …). */
function errorValueOf(v: FormulaValue | undefined): string | undefined {
  return isExcelError(v) ? v : undefined;
}

/** First error literal among values a function consumed from its arguments — Excel propagates it. */
function errorAmong(...values: readonly (FormulaValue | undefined)[]): string | undefined {
  for (const v of values) {
    const err = errorValueOf(v);
    if (err !== undefined) return err;
  }
  return undefined;
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

function evaluateUnary(node: Extract<AstNode, { type: 'unary' }>, resolve: CellResolver, resolveName?: NamedRangeResolver, ctx?: EvalContext): FormulaArgument {
  const value = evaluate(node.operand, resolve, resolveName, ctx);
  if (isSparseRange(value)) return '#VALUE!';
  const shape = shapeOfOperand(node.operand, value, resolveName);
  if (shape === undefined) return unaryScalar(node.op, value as FormulaValue);
  // An array operand maps element-wise and keeps its shape, like the binary operators.
  const { rows, cols } = shape;
  if (rows < 1 || cols < 1) return '#VALUE!';
  const out: FormulaValue[] = new Array(rows * cols);
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) out[y * cols + x] = unaryScalar(node.op, elementOf(value, shape, y, x));
  }
  return rows === 1 && cols === 1 ? out[0] ?? null : matrix(rows, cols, out);
}

function unaryScalar(op: string, value: FormulaValue): FormulaValue {
  const err = errorValueOf(value);
  if (err !== undefined) return err;
  return finiteOrError(op === '-' ? -Number(value) : Number(value));
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
  if (isSparseRange(value)) return '#VALUE!'; // a range too large to materialise is not one value
  if (isFormulaList(value)) return value[0] ?? null;
  if (isMatrix(value)) return value.data[0] ?? null;
  return value;
}

function isFormulaList(value: FormulaArgument): value is readonly FormulaValue[] {
  return Array.isArray(value);
}
