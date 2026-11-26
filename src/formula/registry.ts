import type { FormulaArgument, FormulaValue, SparseRangeValue } from './types';
import { isExcelError, isMatrix, isSparseRange, matrix } from './types';
import { formatCustom } from '../format/CustomFormat';

/**
 * Where the calling formula lives, handed to a function that declares the
 * second `evaluate` parameter. The engine path always supplies it; a bare
 * `evaluate()` call (conditional-format / validation rules) passes `undefined`
 * there — functions must not assume coordinates that do not exist.
 */
export interface FunctionContext {
  readonly cell: { readonly r: number; readonly c: number };
  readonly sheetId: string;
}

export interface FunctionSpec {
  minArgs: number;
  maxArgs: number;
  /**
   * `ctx` names the cell/sheet the calling formula lives in, per
   * {@link FunctionContext}. Declared optional so existing one-parameter
   * implementations (and plugin specs) keep compiling unchanged.
   */
  evaluate: (args: FormulaArgument[], ctx?: FunctionContext) => FormulaArgument;
  /**
   * A volatile function (NOW / TODAY, or a data feed a host marks this way)
   * depends on the wall clock or the world rather than on precedents, so the
   * engine re-evaluates its cell on every recalculation pass that has other
   * work. Detected at evaluation time through the context callback, so a name
   * that turns volatile later is honored without re-parsing.
   */
  volatile?: boolean;
}

export class FunctionRegistry {
  private readonly funcs = new Map<string, FunctionSpec>();

  /**
   * `parent` is consulted for a name this table does not define. An engine's
   * own table chains to the shared one (`registry`), so functions registered
   * directly on the shared table stay visible everywhere, while what a plugin
   * registers through `api.registerFunction` stays with that engine.
   */
  public constructor(private readonly parent?: FunctionRegistry) {}

  register(name: string, spec: FunctionSpec): void {
    this.funcs.set(name.toUpperCase(), spec);
  }

  get(name: string): FunctionSpec | undefined {
    return this.funcs.get(name.toUpperCase()) ?? this.parent?.get(name);
  }

  /**
   * Forgets this table's own registration — what a plugin's undo does to a
   * function it created. A definition inherited from the parent shows again.
   */
  remove(name: string): void {
    this.funcs.delete(name.toUpperCase());
  }

  has(name: string): boolean {
    return this.funcs.has(name.toUpperCase()) || (this.parent?.has(name) ?? false);
  }

  /** True when this table itself defines `name`; a parent's definition does not count. */
  hasOwn(name: string): boolean {
    return this.funcs.has(name.toUpperCase());
  }

  list(): string[] {
    return [...new Set([...this.funcs.keys(), ...(this.parent?.list() ?? [])])];
  }
}

/** The shared table: every built-in, plus whatever hosts register on it directly. */
export const registry = new FunctionRegistry();

registry.register('SUM', { minArgs: 1, maxArgs: 255, evaluate: (args) => sum(flatten(args)) });
registry.register('AVERAGE', { minArgs: 1, maxArgs: 255, evaluate: (args) => average(flatten(args)) });
registry.register('MAX', { minArgs: 1, maxArgs: 255, evaluate: (args) => { const n = numbers(args); return n.length === 0 ? 0 : extremeOf(n, Math.max); } });
registry.register('MIN', { minArgs: 1, maxArgs: 255, evaluate: (args) => { const n = numbers(args); return n.length === 0 ? 0 : extremeOf(n, Math.min); } });
registry.register('COUNT', { minArgs: 1, maxArgs: 255, evaluate: (args) => numbers(args).length });
registry.register('COUNTA', { minArgs: 1, maxArgs: 255, evaluate: (args) => flatten(args).filter((v) => v != null && v !== '').length });
registry.register('ROUND', { minArgs: 1, maxArgs: 2, evaluate: ([n, d]) => round(first(n), first(d)) });
registry.register('ABS', { minArgs: 1, maxArgs: 1, evaluate: ([n]) => Math.abs(Number(first(n))) });
registry.register('INT', { minArgs: 1, maxArgs: 1, evaluate: ([n]) => Math.floor(Number(first(n))) });
registry.register('MOD', { minArgs: 2, maxArgs: 2, evaluate: ([a, b]) => mod(first(a), first(b)) });
// Same operand rules as SUBTOTAL op 6 (the only PRODUCT impl before standalone
// registration): non-numeric operands are ignored, an all-empty input yields 0.
registry.register('PRODUCT', {
  minArgs: 1, maxArgs: 255,
  evaluate: (args) => { const n = numbers(args); return n.length === 0 ? 0 : n.reduce((a, b) => a * b, 1); },
});

// The evaluator intercepts IF for lazy branch evaluation; this body is only
// reached by direct registry callers and mirrors ifLazy's falsy list.
registry.register('IF', { minArgs: 2, maxArgs: 3, evaluate: ([cond, t, f]) => {
  const c = first(cond);
  return (c === false || c === 0 || c === null || c === '') ? first(f) ?? null : first(t) ?? null;
} });
registry.register('AND', { minArgs: 1, maxArgs: 255, evaluate: (args) => logicalOf(args, true) });
registry.register('OR', { minArgs: 1, maxArgs: 255, evaluate: (args) => logicalOf(args, false) });
registry.register('NOT', { minArgs: 1, maxArgs: 1, evaluate: ([v]) => !first(v) });

registry.register('CONCAT', { minArgs: 1, maxArgs: 255, evaluate: (args) => flatten(args).map(text).join('') });
registry.register('LEFT', { minArgs: 1, maxArgs: 2, evaluate: ([s, n]) => text(first(s)).slice(0, n !== undefined ? Number(first(n)) : 1) });
registry.register('RIGHT', { minArgs: 1, maxArgs: 2, evaluate: ([s, n]) => right(first(s), first(n)) });
registry.register('MID', { minArgs: 2, maxArgs: 3, evaluate: ([s, start, len]) => mid(first(s), first(start), first(len)) });
registry.register('LEN', { minArgs: 1, maxArgs: 1, evaluate: ([s]) => text(first(s)).length });
registry.register('UPPER', { minArgs: 1, maxArgs: 1, evaluate: ([s]) => text(first(s)).toUpperCase() });
registry.register('LOWER', { minArgs: 1, maxArgs: 1, evaluate: ([s]) => text(first(s)).toLowerCase() });
registry.register('TRIM', { minArgs: 1, maxArgs: 1, evaluate: ([s]) => text(first(s)).trim() });

registry.register('INDEX', { minArgs: 2, maxArgs: 3, evaluate: ([arr, row]) => valueAt(arr, Number(first(row)) - 1) });
registry.register('MATCH', { minArgs: 2, maxArgs: 3, evaluate: ([search, arr]) => matchIndex(first(search), arr) });
registry.register('COUNTIF', { minArgs: 2, maxArgs: 2, evaluate: ([arr, criteria]) => countIf(arr, first(criteria)) });

registry.register('SUMIF', { minArgs: 2, maxArgs: 3, evaluate: ([range, criteria, sumRange]) => sumIf(range, first(criteria), sumRange) });
registry.register('SUMIFS', { minArgs: 3, maxArgs: 255, evaluate: (args) => sumIfs(args) });
registry.register('COUNTIFS', { minArgs: 2, maxArgs: 255, evaluate: (args) => countIfs(args) });
registry.register('AVERAGEIF', { minArgs: 2, maxArgs: 3, evaluate: ([range, criteria, avgRange]) => averageIf(range, first(criteria), avgRange) });
registry.register('AVERAGEIFS', { minArgs: 3, maxArgs: 255, evaluate: (args) => averageIfs(args) });
registry.register('TEXTJOIN', { minArgs: 3, maxArgs: 255, evaluate: (args) => textJoin(args) });
registry.register('CONCATENATE', { minArgs: 1, maxArgs: 255, evaluate: (args) => flatten(args).map(text).join('') });
registry.register('TEXT', { minArgs: 2, maxArgs: 2, evaluate: ([v, fmt]) => textFormat(first(v), first(fmt)) });
registry.register('VALUE', { minArgs: 1, maxArgs: 1, evaluate: ([v]) => valueFn(first(v)) });
registry.register('ROUNDUP', { minArgs: 1, maxArgs: 2, evaluate: ([n, d]) => roundToward(first(n), first(d), 'up') });
registry.register('ROUNDDOWN', { minArgs: 1, maxArgs: 2, evaluate: ([n, d]) => roundToward(first(n), first(d), 'down') });
registry.register('POWER', { minArgs: 2, maxArgs: 2, evaluate: ([b, e]) => finitePower(first(b), first(e)) });
registry.register('SQRT', { minArgs: 1, maxArgs: 1, evaluate: ([n]) => {
  const x = Number(first(n));
  if (x < 0) return '#NUM!';
  return Math.sqrt(x);
}});
registry.register('PI', { minArgs: 0, maxArgs: 0, evaluate: () => Math.PI });
registry.register('TRUE', { minArgs: 0, maxArgs: 0, evaluate: () => true });
registry.register('FALSE', { minArgs: 0, maxArgs: 0, evaluate: () => false });
registry.register('NA', { minArgs: 0, maxArgs: 0, evaluate: () => '#N/A' });
registry.register('ISBLANK', { minArgs: 1, maxArgs: 1, evaluate: ([v]) => first(v) === null || first(v) === undefined || first(v) === '' });
registry.register('ISNUMBER', { minArgs: 1, maxArgs: 1, evaluate: ([v]) => typeof first(v) === 'number' && Number.isFinite(first(v) as number) });
registry.register('ISTEXT', { minArgs: 1, maxArgs: 1, evaluate: ([v]) => typeof first(v) === 'string' && !isExcelError(first(v)) });
registry.register('ISERROR', { minArgs: 1, maxArgs: 1, evaluate: ([v]) => isExcelError(first(v)) });
// Excel: ISERR is every error except #N/A.
registry.register('ISERR', { minArgs: 1, maxArgs: 1, evaluate: ([v]) => { const e = first(v); return isExcelError(e) && e !== '#N/A'; } });
registry.register('ISNA', { minArgs: 1, maxArgs: 1, evaluate: ([v]) => first(v) === '#N/A' });

// Dates are Excel serial numbers (1900 date system: serial 1 = 1899-12-31), the
// same value an xlsx import leaves in a date cell — so they add and subtract.
// NOW / TODAY are volatile (Excel): every recalculation that has other work
// re-evaluates them, so a sheet left open crosses midnight correctly.
registry.register('NOW', { minArgs: 0, maxArgs: 0, volatile: true, evaluate: () => nowSerial(new Date()) });
registry.register('TODAY', { minArgs: 0, maxArgs: 0, volatile: true, evaluate: () => todaySerial(new Date()) });
registry.register('DATE', { minArgs: 3, maxArgs: 3, evaluate: ([y, m, d]) => dateOf(first(y), first(m), first(d)) });
registry.register('TIME', { minArgs: 3, maxArgs: 3, evaluate: ([h, m, s]) => timeOf(first(h), first(m), first(s)) });
registry.register('DATEDIF', { minArgs: 3, maxArgs: 3, evaluate: ([a, b, unit]) => dateDif(first(a), first(b), text(first(unit))) });
registry.register('YEAR', { minArgs: 1, maxArgs: 1, evaluate: ([d]) => dateParts(first(d)).year });
registry.register('MONTH', { minArgs: 1, maxArgs: 1, evaluate: ([d]) => dateParts(first(d)).month });
registry.register('DAY', { minArgs: 1, maxArgs: 1, evaluate: ([d]) => dateParts(first(d)).day });
registry.register('HOUR', { minArgs: 1, maxArgs: 1, evaluate: ([d]) => dateParts(first(d)).hours });
registry.register('MINUTE', { minArgs: 1, maxArgs: 1, evaluate: ([d]) => dateParts(first(d)).minutes });
registry.register('SECOND', { minArgs: 1, maxArgs: 1, evaluate: ([d]) => dateParts(first(d)).seconds });

// ——— Text positions / replacement ———
registry.register('FIND', { minArgs: 2, maxArgs: 3, evaluate: ([needle, hay, start]) => findText(text(first(needle)), text(first(hay)), first(start), false) });
registry.register('SEARCH', { minArgs: 2, maxArgs: 3, evaluate: ([needle, hay, start]) => findText(text(first(needle)), text(first(hay)), first(start), true) });
registry.register('SUBSTITUTE', { minArgs: 3, maxArgs: 4, evaluate: ([s, old, rep, instance]) => substitute(text(first(s)), text(first(old)), text(first(rep)), first(instance)) });
registry.register('REPLACE', { minArgs: 4, maxArgs: 4, evaluate: ([s, start, len, rep]) => replaceAt(text(first(s)), Number(first(start)), Number(first(len)), text(first(rep))) });
registry.register('EXACT', { minArgs: 2, maxArgs: 2, evaluate: ([a, b]) => text(first(a)) === text(first(b)) });

// ——— Conditional / statistical aggregates ———
registry.register('SUMPRODUCT', { minArgs: 1, maxArgs: 255, evaluate: (args) => sumProduct(args) });
registry.register('MEDIAN', { minArgs: 1, maxArgs: 255, evaluate: (args) => median(numbers(args)) });
registry.register('LARGE', { minArgs: 2, maxArgs: 2, evaluate: ([arr, k]) => largeSmall(numbers([arr!]), Number(first(k)), 'large') });
registry.register('SMALL', { minArgs: 2, maxArgs: 2, evaluate: ([arr, k]) => largeSmall(numbers([arr!]), Number(first(k)), 'small') });
registry.register('STDEV.P', { minArgs: 1, maxArgs: 255, evaluate: (args) => stdev(numbers(args), 'population') });
registry.register('STDEVP', { minArgs: 1, maxArgs: 255, evaluate: (args) => stdev(numbers(args), 'population') });
registry.register('STDEV.S', { minArgs: 1, maxArgs: 255, evaluate: (args) => stdev(numbers(args), 'sample') });
registry.register('STDEV', { minArgs: 1, maxArgs: 255, evaluate: (args) => stdev(numbers(args), 'sample') });
registry.register('RANK.EQ', { minArgs: 2, maxArgs: 3, evaluate: ([v, arr, order]) => rankEq(first(v), arr, first(order)) });
registry.register('RANK', { minArgs: 2, maxArgs: 3, evaluate: ([v, arr, order]) => rankEq(first(v), arr, first(order)) });
registry.register('MAXIFS', { minArgs: 3, maxArgs: 255, evaluate: (args) => maxMinIfs(args, 'max') });
registry.register('MINIFS', { minArgs: 3, maxArgs: 255, evaluate: (args) => maxMinIfs(args, 'min') });
// Excel COUNTBLANK: never-stored addresses and empty-string cells both count;
// over a sparse range the blank total is the area minus the stored non-blanks.
registry.register('COUNTBLANK', { minArgs: 1, maxArgs: 1, evaluate: ([range]) => countBlank(range) });

/** What a logical aggregate saw: how many values counted and how they read. */
interface TruthyScan {
  counted: number;
  allTruthy: boolean;
  anyTruthy: boolean;
  error: string | undefined;
}

/**
 * Excel AND/OR: blank cells and text inside range/array arguments are
 * ignored; booleans and numbers (0 = FALSE) decide. A direct string argument
 * coerces ("TRUE"/"FALSE", or a number); anything else is '#VALUE!'. Blank
 * values are skipped, so over a sparse range the never-stored addresses take
 * no part — if nothing counted at all, the answer is '#VALUE!' (Excel on an
 * all-empty range).
 */
function scanTruthy(args: FormulaArgument[]): TruthyScan {
  const scan: TruthyScan = { counted: 0, allTruthy: true, anyTruthy: false, error: undefined };
  const countValue = (v: FormulaValue | undefined, fromList: boolean): void => {
    if (scan.error !== undefined) return;
    if (fromList) {
      if (v === null || v === undefined || v === '') return; // blank: ignored
      if (typeof v === 'boolean') {
        scan.counted += 1;
        if (v) scan.anyTruthy = true; else scan.allTruthy = false;
        return;
      }
      if (typeof v === 'number') {
        // Non-finite numbers never exist in Excel; a cell whose value is NaN
        // resolves as its text instead (see the engine's resolveCell).
        if (!Number.isFinite(v)) {
          scan.counted += 1;
          scan.allTruthy = false;
          return;
        }
        scan.counted += 1;
        if (v !== 0) scan.anyTruthy = true; else scan.allTruthy = false;
        return;
      }
      if (typeof v === 'string') {
        // A typed TRUE/FALSE can reach us as text (a host that stores only
        // the text); it still counts as the logical it spells.
        const upper = v.trim().toUpperCase();
        if (upper === 'TRUE') {
          scan.counted += 1;
          scan.anyTruthy = true;
          return;
        }
        if (upper === 'FALSE') {
          scan.counted += 1;
          scan.allTruthy = false;
        }
        return; // other text inside a range is ignored (Excel)
      }
      return;
    }
    if (v === null || v === undefined || v === '') return; // a blank reference is ignored
    if (typeof v === 'boolean') {
      scan.counted += 1;
      if (v) scan.anyTruthy = true; else scan.allTruthy = false;
      return;
    }
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) return;
      scan.counted += 1;
      if (v !== 0) scan.anyTruthy = true; else scan.allTruthy = false;
      return;
    }
    if (v instanceof Date) return; // a raw Date is not a logical value
    const upper = v.trim().toUpperCase();
    if (upper === 'TRUE') { scan.counted += 1; scan.anyTruthy = true; return; }
    if (upper === 'FALSE') { scan.counted += 1; scan.allTruthy = false; return; }
    const n = numericOf(v);
    if (n !== undefined) {
      scan.counted += 1;
      if (n !== 0) scan.anyTruthy = true; else scan.allTruthy = false;
      return;
    }
    scan.error = '#VALUE!';
  };
  for (const arg of args) {
    if (scan.error !== undefined) break;
    if (isSparseRange(arg)) {
      arg.forEachStored((v) => countValue(v, true));
      continue;
    }
    if (Array.isArray(arg)) {
      for (const v of arg) countValue(v, true);
      continue;
    }
    if (isMatrix(arg)) {
      for (const v of arg.data) countValue(v, true);
      continue;
    }
    countValue(arg as FormulaValue, false);
  }
  return scan;
}

/** AND when `all`, OR otherwise; both answer '#VALUE!' with no logical value. */
function logicalOf(args: FormulaArgument[], all: boolean): FormulaArgument {
  const scan = scanTruthy(args);
  if (scan.error !== undefined) return scan.error;
  if (scan.counted === 0) return '#VALUE!';
  return all ? scan.allTruthy : scan.anyTruthy;
}

/** Excel COUNTBLANK: missing addresses and '' cells are blank; values are not. */
function countBlank(value: FormulaArgument | undefined): FormulaArgument {
  if (isSparseRange(value)) {
    let nonBlank = 0;
    value.forEachStored((v) => { if (v !== null && v !== '') nonBlank += 1; });
    return value.area - nonBlank;
  }
  return flatten(value === undefined ? [] : [value]).filter((v) => v === null || v === '').length;
}

function sum(values: FormulaValue[]): number {
  // Excel SUM ignores real text and empty cells inside ranges (errors already
  // propagated at the evaluator level); numeric-looking text coerces. Index
  // loop: this runs over million-cell ranges.
  let total = 0;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    if (typeof v === 'number') total += Number.isFinite(v) ? v : 0;
    else total += numericOf(v) ?? 0;
  }
  return total;
}

function average(values: FormulaValue[]): FormulaArgument {
  const numeric = values.flatMap((v) => {
    const n = numericOf(v);
    return n === undefined ? [] : [n];
  });
  if (numeric.length === 0) return '#DIV/0!';
  return sum(numeric) / numeric.length;
}

/** Excel COUNT/SUM-family operand list: numbers and numeric text, never null or real text. */
function numbers(values: FormulaArgument[]): number[] {
  return flatten(values).flatMap((v) => {
    const n = numericOf(v);
    return n === undefined ? [] : [n];
  });
}

/** MAX/MIN over a list that may hold a million range cells — `Math.max(…spread)` would blow the call stack. */
function extremeOf(values: readonly number[], pick: (a: number, b: number) => number): number {
  let best = values[0]!;
  for (let i = 1; i < values.length; i += 1) best = pick(best, values[i]!);
  return best;
}

function numericOf(v: FormulaValue | null | undefined): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/** Excel MOD: divisor 0 → #DIV/0!; result takes the divisor's sign. */
function mod(a: FormulaValue | undefined, b: FormulaValue | undefined): FormulaArgument {
  const divisor = Number(b);
  if (divisor === 0 || !Number.isFinite(divisor)) return '#DIV/0!';
  const dividend = Number(a);
  if (!Number.isFinite(dividend)) return '#VALUE!';
  return ((dividend % divisor) + divisor) % divisor;
}

function flatten(values: FormulaArgument[]): FormulaValue[] {
  return values.flatMap((value) => {
    if (Array.isArray(value)) return value;
    if (isSparseRange(value)) return materializeStored(value);
    if (typeof value === 'object' && value !== null && (value as { __matrix?: boolean }).__matrix === true) return [...(value as { data: readonly FormulaValue[] }).data];
    return [value as FormulaValue];
  });
}

/** Stored cells of a sparse range as a flat list (never its area in blanks). */
function materializeStored(value: SparseRangeValue): FormulaValue[] {
  const out: FormulaValue[] = [];
  value.forEachStored((v) => { out.push(v); });
  return out;
}

/**
 * A sparse range argument as its stored values keyed by row-major offset from
 * the range's top-left corner; undefined when the argument is not sparse.
 * The IF-family aligns a sum/average range to its criteria range by this
 * offset, exactly as dense code indexes both lists at `i`.
 */
function sparseMap(value: FormulaArgument | undefined): Map<number, FormulaValue> | undefined {
  if (!isSparseRange(value)) return undefined;
  const map = new Map<number, FormulaValue>();
  value.forEachStored((v, y, x) => { map.set((y - value.top) * value.cols + (x - value.left), v); });
  return map;
}

function first(value: FormulaArgument | undefined): FormulaValue | undefined {
  if (value === undefined) return undefined;
  if (isFormulaList(value)) return value[0];
  if (typeof value === 'object' && value !== null && (value as { __matrix?: boolean }).__matrix === true) return (value as { data: readonly FormulaValue[] }).data[0];
  return value as FormulaValue;
}

/** Excel text coercion: empty cells are "" in text contexts, not "null". */
function text(v: FormulaValue | undefined): string {
  if (v === undefined || v === null) return '';
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function isFormulaList(value: FormulaArgument): value is readonly FormulaValue[] {
  return Array.isArray(value);
}

/** Excel rounds halves away from zero (ROUND(-2.5) is -3); Math.round alone would give -2. */
function round(n: FormulaValue | undefined, d: FormulaValue | undefined): number {
  const factor = Math.pow(10, d !== undefined ? Number(d) : 0);
  const scaled = Number(n) * factor;
  return (Math.sign(scaled) * Math.round(Math.abs(scaled))) / factor;
}

function right(s: FormulaValue | undefined, n: FormulaValue | undefined): string {
  return text(s).slice(-(n !== undefined ? Number(n) : 1));
}

function mid(s: FormulaValue | undefined, start: FormulaValue | undefined, len: FormulaValue | undefined): string {
  const from = Number(start) - 1;
  return text(s).slice(from, len !== undefined ? from + Number(len) : undefined);
}

function valueAt(value: FormulaArgument | undefined, index: number): FormulaValue {
  const values = value === undefined ? [] : flatten([value]);
  return values[index] ?? null;
}

function matchIndex(search: FormulaValue | undefined, value: FormulaArgument | undefined): number {
  const values = value === undefined ? [] : flatten([value]);
  return values.findIndex((entry) => entry === search) + 1;
}

function countIf(value: FormulaArgument | undefined, criteria: FormulaValue | undefined): number {
  if (isSparseRange(value)) {
    let counted = 0;
    let walked = 0;
    value.forEachStored((v) => {
      walked += 1;
      if (matchesCriteria(v, criteria)) counted += 1;
    });
    // Never-stored addresses are pure blanks; "" and "=" match them — the
    // remainder is arithmetic, not another walk over the emptiness.
    if (matchesBlank(criteria)) counted += value.area - walked;
    return counted;
  }
  const values = value === undefined ? [] : flatten([value]);
  return values.filter((entry) => matchesCriteria(entry, criteria)).length;
}

function sumIf(range: FormulaArgument | undefined, criteria: FormulaValue | undefined, sumRange: FormulaArgument | undefined): number {
  if (isSparseRange(range) || isSparseRange(sumRange)) {
    const group = criteriaGroup([range, sumRange ?? range], matchesBlank(criteria));
    let total = 0;
    for (const i of group.domainOffsets) {
      if (!group.domainHas(i)) continue;
      if (!matchesCriteria(group.at(0, i), criteria)) continue;
      total += numericOf(group.at(1, i)) ?? 0;
    }
    return total;
  }
  const keys = range === undefined ? [] : flatten([range]);
  const vals = sumRange === undefined ? keys : flatten([sumRange]);
  let total = 0;
  for (let i = 0; i < keys.length; i += 1) {
    if (matchesCriteria(keys[i] ?? null, criteria)) total += numericOf(vals[i] ?? null) ?? 0;
  }
  return total;
}

/** SUMIFS(sumRange, critRange1, crit1, …) */
function sumIfs(args: FormulaArgument[]): number {
  if (args.length < 3 || args.length % 2 === 0) return 0;
  const ranges: FormulaArgument[] = [args[0]!];
  const crits: (FormulaValue | undefined)[] = [];
  for (let i = 1; i + 1 < args.length; i += 2) {
    ranges.push(args[i]!);
    crits.push(first(args[i + 1]));
  }
  if (ranges.some(isSparseRange)) {
    const group = criteriaGroup(ranges, crits.some(matchesBlank));
    let total = 0;
    for (const i of group.domainOffsets) {
      if (!group.domainHas(i)) continue;
      if (groupMatches(group, ranges.length, crits, 1, i)) total += numericOf(group.at(0, i)) ?? 0;
    }
    return total;
  }
  const sumVals = flatten([args[0]!]);
  const pairs: { keys: FormulaValue[]; crit: FormulaValue | undefined }[] = [];
  for (let i = 1; i + 1 < args.length; i += 2) {
    pairs.push({ keys: flatten([args[i]!]), crit: first(args[i + 1]) });
  }
  let total = 0;
  for (let i = 0; i < sumVals.length; i += 1) {
    if (pairs.every((p) => matchesCriteria(p.keys[i] ?? null, p.crit))) total += numericOf(sumVals[i] ?? null) ?? 0;
  }
  return total;
}

function countIfs(args: FormulaArgument[]): number {
  if (args.length < 2 || args.length % 2 !== 0) return 0;
  const ranges: FormulaArgument[] = [];
  const crits: (FormulaValue | undefined)[] = [];
  for (let i = 0; i + 1 < args.length; i += 2) {
    ranges.push(args[i]!);
    crits.push(first(args[i + 1]));
  }
  if (ranges.some(isSparseRange)) {
    const blanksMatter = crits.some(matchesBlank);
    const group = criteriaGroup(ranges, blanksMatter);
    let count = 0;
    for (const i of group.domainOffsets) {
      if (!group.domainHas(i)) continue;
      if (groupMatches(group, ranges.length, crits, 0, i)) count += 1;
    }
    // Positions absent from every criteria range are all blank at once; they
    // match iff every criterion matches blanks (Excel). Only walkable
    // arithmetically when the walk was the union of sparse members.
    if (blanksMatter && group.fullySparse && group.domainArea !== undefined) count += group.domainArea - group.walkedCount;
    return count;
  }
  const pairs: { keys: FormulaValue[]; crit: FormulaValue | undefined }[] = [];
  for (let i = 0; i + 1 < args.length; i += 2) {
    pairs.push({ keys: flatten([args[i]!]), crit: first(args[i + 1]) });
  }
  const len = pairs[0]?.keys.length ?? 0;
  let count = 0;
  for (let i = 0; i < len; i += 1) {
    if (pairs.every((p) => matchesCriteria(p.keys[i] ?? null, p.crit))) count += 1;
  }
  return count;
}

/** Offsets 0..n-1, the dense domain of a criteria group. */
function* upTo(n: number): Generator<number> {
  for (let i = 0; i < n; i += 1) yield i;
}

/** True when the criterion matches a blank cell (`""`, `=`, omitted). */
function matchesBlank(criteria: FormulaValue | undefined): boolean {
  return matchesCriteria(null, criteria);
}

/** True when every criterion of the group matches at offset `i` (members `from`..). */
function groupMatches(group: CriteriaGroup, memberCount: number, crits: readonly (FormulaValue | undefined)[], from: number, i: number): boolean {
  for (let k = from; k < memberCount; k += 1) {
    if (!matchesCriteria(group.at(k, i), crits[k - from])) return false;
  }
  return true;
}

/**
 * An aligned criteria group (the SUMIFS family): member 0 is the range whose
 * offsets the walk follows (the sum/average/value range, or the first
 * criteria range for COUNTIFS), the rest line up by the same offset. A
 * sparse member reads from its stored-values map; a dense member indexes
 * like the original loops, missing positions reading as blanks.
 *
 * `blanksMatter` (some criterion matches a blank, i.e. `""` / `=`) widens
 * the walk: positions missing from the first member can still be decided by
 * the others, so the walk follows the union of every sparse member's stored
 * offsets (or a dense member's full span, which is within the dense
 * ceiling). What stays unwalked is then only the positions absent from
 * every sparse member — all blank at once, countable arithmetically
 * (`domainArea - walkedCount`) instead of looping over the emptiness.
 */
interface CriteriaGroup {
  at: (k: number, i: number) => FormulaValue;
  /** Offsets to visit, ascending. */
  domainOffsets: Iterable<number>;
  /** False when offset `i` is not visited (absent from every sparse member). */
  domainHas: (i: number) => boolean;
  /** Offsets the walk actually visits. */
  walkedCount: number;
  /** True when every member is a sparse range (the walk is the union). */
  fullySparse: boolean;
  /** Area of the first member when it is sparse; undefined for a dense domain. */
  domainArea: number | undefined;
}

function criteriaGroup(members: readonly (FormulaArgument | undefined)[], blanksMatter: boolean): CriteriaGroup {
  const maps = members.map((m) => sparseMap(m));
  const denses = members.map((m, k) => (maps[k] === undefined ? flatten(m === undefined ? [] : [m]) : undefined));
  const domainMap = maps[0];
  const domainArea = isSparseRange(members[0]) ? (members[0] as SparseRangeValue).area : undefined;
  const at = (k: number, i: number): FormulaValue => (maps[k] !== undefined ? maps[k]!.get(i) ?? null : denses[k]![i] ?? null);
  const denseMember = denses.find((d) => d !== undefined);
  if (domainMap === undefined || denseMember !== undefined) {
    // A dense member pins the walk to its full span (within the dense
    // ceiling): every position is visited, sparse members read by offset.
    const len = (domainMap === undefined ? denses[0]! : denseMember!).length;
    return { at, domainOffsets: upTo(len), domainHas: () => true, walkedCount: len, fullySparse: false, domainArea };
  }
  if (blanksMatter) {
    const union = new Set<number>();
    for (const m of maps) {
      if (m === undefined) continue;
      for (const k of m.keys()) union.add(k);
    }
    return { at, domainOffsets: union, domainHas: (i) => union.has(i), walkedCount: union.size, fullySparse: true, domainArea };
  }
  return { at, domainOffsets: domainMap.keys(), domainHas: (i) => domainMap.has(i), walkedCount: domainMap.size, fullySparse: true, domainArea };
}


function averageIf(range: FormulaArgument | undefined, criteria: FormulaValue | undefined, avgRange: FormulaArgument | undefined): FormulaArgument {
  if (isSparseRange(range) || isSparseRange(avgRange)) {
    const group = criteriaGroup([range, avgRange ?? range], matchesBlank(criteria));
    let total = 0;
    let count = 0;
    for (const i of group.domainOffsets) {
      if (!group.domainHas(i)) continue;
      if (!matchesCriteria(group.at(0, i), criteria)) continue;
      const n = numericOf(group.at(1, i));
      if (n === undefined) continue;
      total += n;
      count += 1;
    }
    return count === 0 ? '#DIV/0!' : total / count;
  }
  const keys = range === undefined ? [] : flatten([range]);
  const vals = avgRange === undefined ? keys : flatten([avgRange]);
  let total = 0;
  let count = 0;
  for (let i = 0; i < keys.length; i += 1) {
    if (!matchesCriteria(keys[i] ?? null, criteria)) continue;
    const n = numericOf(vals[i] ?? null);
    if (n === undefined) continue;
    total += n;
    count += 1;
  }
  if (count === 0) return '#DIV/0!';
  return total / count;
}

function averageIfs(args: FormulaArgument[]): FormulaArgument {
  if (args.length < 3 || args.length % 2 === 0) return '#DIV/0!';
  const ranges: FormulaArgument[] = [args[0]!];
  const crits: (FormulaValue | undefined)[] = [];
  for (let i = 1; i + 1 < args.length; i += 2) {
    ranges.push(args[i]!);
    crits.push(first(args[i + 1]));
  }
  if (ranges.some(isSparseRange)) {
    const group = criteriaGroup(ranges, crits.some(matchesBlank));
    let total = 0;
    let count = 0;
    for (const i of group.domainOffsets) {
      if (!group.domainHas(i)) continue;
      if (!groupMatches(group, ranges.length, crits, 1, i)) continue;
      const n = numericOf(group.at(0, i));
      if (n === undefined) continue;
      total += n;
      count += 1;
    }
    return count === 0 ? '#DIV/0!' : total / count;
  }
  const avgVals = flatten([args[0]!]);
  const pairs: { keys: FormulaValue[]; crit: FormulaValue | undefined }[] = [];
  for (let i = 1; i + 1 < args.length; i += 2) {
    pairs.push({ keys: flatten([args[i]!]), crit: first(args[i + 1]) });
  }
  let total = 0;
  let count = 0;
  for (let i = 0; i < avgVals.length; i += 1) {
    if (!pairs.every((p) => matchesCriteria(p.keys[i] ?? null, p.crit))) continue;
    const n = numericOf(avgVals[i] ?? null);
    if (n === undefined) continue;
    total += n;
    count += 1;
  }
  if (count === 0) return '#DIV/0!';
  return total / count;
}

function textJoin(args: FormulaArgument[]): string {
  const delim = text(first(args[0]));
  const ignoreEmpty = Boolean(first(args[1]));
  const parts: string[] = [];
  for (const entry of flatten(args.slice(2))) {
    const s = text(entry);
    if (ignoreEmpty && s === '') continue;
    parts.push(s);
  }
  return parts.join(delim);
}

type CriteriaOp = '>' | '<' | '>=' | '<=' | '<>' | '=';

const CRITERIA_OPS: readonly CriteriaOp[] = ['>=', '<=', '<>', '>', '<', '='];

/**
 * Excel criteria (COUNTIF / SUMIF family): a number, a comparison (`">5"`,
 * `"<>a"`) or text — case-insensitive, `*` / `?` wildcards with `~` as the
 * escape. A blank cell (or an empty string) satisfies only `""` / `"="`; it
 * never matches a comparison, so `"<5"` over an empty range counts nothing.
 */
function matchesCriteria(value: FormulaValue | undefined, criteria: FormulaValue | undefined): boolean {
  const blank = value === null || value === undefined || value === '';
  if (criteria === undefined || criteria === null) return blank;
  const crit = text(criteria);
  for (const op of CRITERIA_OPS) {
    if (crit.startsWith(op)) return applyCriteria(value, blank, crit.slice(op.length), op);
  }
  return applyCriteria(value, blank, crit, '=');
}

function applyCriteria(value: FormulaValue | undefined, blank: boolean, rhs: string, op: CriteriaOp): boolean {
  if (op === '<>') return !blank && !equalCriteria(value, rhs);
  if (blank) return rhs === '';
  if (rhs === '') return false;
  const rhsNum = numericOf(rhs);
  if (rhsNum !== undefined) {
    // A numeric criterion only ever compares numbers (numeric text coerces), like Excel's COUNTIF.
    const lhsNum = numericOf(value);
    return lhsNum !== undefined && compareNumbers(lhsNum, rhsNum, op);
  }
  // Text ordering compares text with text; numbers are left out.
  if (op !== '=') return typeof value === 'string' && orderText(value.toLowerCase(), rhs.toLowerCase(), op);
  return equalCriteria(value, rhs);
}

/** Numeric when both sides read as numbers, otherwise Excel text matching (case-insensitive, wildcards). */
function equalCriteria(value: FormulaValue | undefined, rhs: string): boolean {
  const rhsNum = numericOf(rhs);
  if (rhsNum !== undefined) {
    const lhsNum = numericOf(value);
    return lhsNum !== undefined && lhsNum === rhsNum;
  }
  const pattern = rhs.toLowerCase();
  if (!/[*?~]/.test(pattern)) return text(value).toLowerCase() === pattern;
  return typeof value === 'string' && new RegExp(`^${wildcardToRegExp(pattern, '').source}$`).test(value.toLowerCase());
}

function compareNumbers(lhs: number, rhs: number, op: CriteriaOp): boolean {
  switch (op) {
    case '>': return lhs > rhs;
    case '<': return lhs < rhs;
    case '>=': return lhs >= rhs;
    case '<=': return lhs <= rhs;
    case '<>': return lhs !== rhs;
    default: return lhs === rhs;
  }
}

function orderText(lhs: string, rhs: string, op: CriteriaOp): boolean {
  switch (op) {
    case '>': return lhs > rhs;
    case '<': return lhs < rhs;
    case '>=': return lhs >= rhs;
    default: return lhs <= rhs;
  }
}

function valueFn(v: FormulaValue | undefined): FormulaArgument {
  if (typeof v === 'number') return v;
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : '#VALUE!';
}

function roundToward(n: FormulaValue | undefined, d: FormulaValue | undefined, dir: 'up' | 'down'): number {
  const digits = d !== undefined ? Number(d) : 0;
  const factor = Math.pow(10, digits);
  const x = Number(n) * factor;
  const rounded = dir === 'up'
    ? (x >= 0 ? Math.ceil(x) : Math.floor(x))
    : (x >= 0 ? Math.floor(x) : Math.ceil(x));
  return rounded / factor;
}

function finitePower(b: FormulaValue | undefined, e: FormulaValue | undefined): FormulaArgument {
  const r = Math.pow(Number(b), Number(e));
  if (Number.isNaN(r) || !Number.isFinite(r)) return '#NUM!';
  return r;
}

/** True for a format built from date/time tokens (outside quotes and [brackets]) rather than digit placeholders. */
function isDateTimeFormat(pattern: string): boolean {
  return /[ymdhs]/i.test(pattern.replace(/\[[^\]]*\]/g, '').replace(/"[^"]*"/g, ''));
}

/**
 * Minimal TEXT: 0 / 0.00 / #,##0 / General, and the date/time formats
 * (yyyy-mm-dd, yyyy/m/d, mm/dd/yyyy, d-mmm-yyyy, hh:mm …) — the cell
 * formatter applied to the serial of a number, a date/time text or a Date.
 * Anything that is not a date comes back as text.
 */
function dateTimeText(v: FormulaValue | undefined, pattern: string): string {
  const ms = wallClockMs(v);
  const formatted = Number.isNaN(ms) ? undefined : formatCustom((ms - EXCEL_EPOCH_MS) / DAY_MS, pattern);
  return formatted === undefined ? text(v) : formatted.text;
}

function textFormat(v: FormulaValue | undefined, fmt: FormulaValue | undefined): string {
  const pattern = String(fmt ?? 'General');
  if (isDateTimeFormat(pattern)) return dateTimeText(v, pattern);
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return String(v ?? '');
  if (pattern === '0') return String(Math.round(n));
  if (pattern === '0.00') return n.toFixed(2);
  if (pattern === '#,##0' || pattern === '#,##0.00') {
    const fixed = pattern.includes('.') ? n.toFixed(2) : String(Math.round(n));
    const parts = fixed.split('.');
    const withComma = (parts[0] ?? '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts[1] !== undefined ? withComma + '.' + parts[1] : withComma;
  }
  return String(n);
}


/**
 * Excel serial 1 = 1899-12-31: the epoch sits two days before 1900, which
 * absorbs Excel's phantom 1900-02-29 for every date from 1900-03-01 on. The
 * same epoch as NumberFormatter.serialToDate and the xlsx import, so a serial
 * from DATE() is exactly what an imported date cell holds.
 */
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;

function serialToDate(serial: number): Date {
  return new Date(EXCEL_EPOCH_MS + Math.round(serial * DAY_MS));
}

function toDate(value: FormulaValue | undefined): Date {
  if (value instanceof Date) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return serialToDate(value);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    // Bare time strings ("13:30") don't parse in every engine — anchor them at UTC.
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(trimmed)) return new Date(`1970-01-01T${trimmed.length === 5 ? `${trimmed}:00` : trimmed}Z`);
    // A YYYY-MM-DD text is a calendar day, not a local instant.
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return new Date(`${trimmed}T00:00:00Z`);
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) return serialToDate(Number(trimmed));
    return new Date(trimmed);
  }
  return new Date('');
}

/**
 * A date/time argument as the wall-clock instant it stands for (ms; read it
 * back with the UTC getters). A serial number is a wall-clock date with no
 * time zone, so it is decoded straight from the 1900 epoch and comes out as
 * the calendar it was built from — DATE / TODAY / NOW and an xlsx import all
 * write local dates, so HOUR(NOW()) is the hour on the wall clock in any
 * zone. A JS Date handed in by the host is a real instant and is read in the
 * local zone. Text is read as the wall-clock it spells out. NaN when the
 * value is not a date at all.
 */
function wallClockMs(value: FormulaValue | undefined): number {
  if (value instanceof Date) {
    return Date.UTC(value.getFullYear(), value.getMonth(), value.getDate(), value.getHours(), value.getMinutes(), value.getSeconds(), value.getMilliseconds());
  }
  if (typeof value === 'number') return EXCEL_EPOCH_MS + Math.round(value * DAY_MS);
  if (typeof value === 'string') return parseWallClock(value.trim());
  return Number.NaN;
}

/** Wall-clock ms for the date/time spellings read from text: "13:30[:05]", "2024-01-31[ 13:30[:05]]" (also with "/"), a serial number. NaN for anything else. */
function parseWallClock(text: string): number {
  const time = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/);
  if (time !== null) {
    const seconds = Number(time[1] ?? 0) * 3600 + Number(time[2] ?? 0) * 60 + Number(time[3] ?? 0);
    return EXCEL_EPOCH_MS + seconds * 1000;
  }
  const full = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/);
  if (full !== null) {
    return Date.UTC(Number(full[1]), Number(full[2]) - 1, Number(full[3]), Number(full[4] ?? 0), Number(full[5] ?? 0), Number(full[6] ?? 0));
  }
  if (/^-?\d+(\.\d+)?$/.test(text)) return EXCEL_EPOCH_MS + Math.round(Number(text) * DAY_MS);
  // Anything else goes through the engine's own parser; without a zone in the text that is local time.
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? Number.NaN : wallClockMs(parsed);
}

/** Calendar fields of a date/time argument (NaN each when it is not a date, which becomes #VALUE!). */
function dateParts(value: FormulaValue | undefined): { readonly year: number; readonly month: number; readonly day: number; readonly hours: number; readonly minutes: number; readonly seconds: number } {
  const d = new Date(wallClockMs(value));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hours: d.getUTCHours(), minutes: d.getUTCMinutes(), seconds: d.getUTCSeconds() };
}

/** Today's date as its serial number — the local calendar day, built from its own fields so DST cannot shift it. */
function todaySerial(now: Date): number {
  return (Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - EXCEL_EPOCH_MS) / DAY_MS;
}

/** Now as a serial number: today plus the local clock's fraction of a day. */
function nowSerial(now: Date): number {
  const ms = ((now.getHours() * 60 + now.getMinutes()) * 60 + now.getSeconds()) * 1000 + now.getMilliseconds();
  return todaySerial(now) + ms / DAY_MS;
}

/** DATE(y, m, d): Excel normalizes month/day overflow via calendar arithmetic; the result is the day's serial number. */
function dateOf(y: FormulaValue | undefined, m: FormulaValue | undefined, d: FormulaValue | undefined): FormulaArgument {
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return '#VALUE!';
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() < 0 || dt.getUTCFullYear() > 9999) return '#NUM!';
  return (dt.getTime() - EXCEL_EPOCH_MS) / DAY_MS;
}

/** TIME(h, m, s): normalized "HH:mm:ss" (values wrap around midnight, Excel-style). */
function timeOf(h: FormulaValue | undefined, m: FormulaValue | undefined, s: FormulaValue | undefined): FormulaArgument {
  const H = Number(h);
  const M = Number(m);
  const S = Number(s);
  if (!Number.isFinite(H) || !Number.isFinite(M) || !Number.isFinite(S)) return '#VALUE!';
  const total = ((Math.trunc(H) * 3600 + Math.trunc(M) * 60 + Math.trunc(S)) % 86400 + 86400) % 86400;
  const hh = String(Math.floor(total / 3600)).padStart(2, '0');
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

/** DATEDIF(start, end, unit) with Excel's Y/M/D/YM/YD/MD boundaries. */
function dateDif(startV: FormulaValue | undefined, endV: FormulaValue | undefined, unit: string): FormulaArgument {
  const start = toDate(startV);
  const end = toDate(endV);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return '#VALUE!';
  if (end.getTime() < start.getTime()) return '#NUM!';
  /** EDATE-style month add: day clamps to the target month's length
   * (Jan 31 + 1 month → Feb 29, never Mar 2). Excel counts DATEDIF
   * months/anniversaries with this clamping. */
  const monthAdd = (base: Date, months: number): Date => {
    const year = base.getUTCFullYear();
    const month = base.getUTCMonth() + months;
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return new Date(Date.UTC(year, month, Math.min(base.getUTCDate(), lastDay)));
  };
  // Largest n with monthAdd(start, n) <= end (start itself counts as n = 0).
  let fullMonths = 0;
  while (monthAdd(start, fullMonths + 1) <= end) fullMonths += 1;
  const daysBetween = (a: Date, b: Date): number => Math.round((b.getTime() - a.getTime()) / 86400000);
  switch (unit.toUpperCase()) {
    case 'Y':
      return Math.floor(fullMonths / 12);
    case 'M':
      return fullMonths;
    case 'D':
      return daysBetween(start, end);
    case 'YM':
      return fullMonths % 12;
    case 'YD':
      return daysBetween(monthAdd(start, 12 * Math.floor(fullMonths / 12)), end);
    case 'MD':
      return daysBetween(monthAdd(start, fullMonths), end);
    default:
      return '#VALUE!';
  }
}

/** FIND (case-sensitive, literal) / SEARCH (case-insensitive, * ? wildcards, ~ escape). */
function findText(needle: string, hay: string, startV: FormulaValue | undefined, wildcard: boolean): FormulaArgument {
  const start = startV === undefined ? 1 : Number(startV);
  if (!Number.isInteger(start) || start < 1 || start > hay.length + 1) return '#VALUE!';
  if (needle === '') return start;
  const from = start - 1;
  if (!wildcard) {
    const at = hay.indexOf(needle, from);
    return at === -1 ? '#VALUE!' : at + 1;
  }
  const lower = hay.toLowerCase();
  const pattern = wildcardToRegExp(needle.toLowerCase(), 'g');
  pattern.lastIndex = from;
  const m = pattern.exec(lower);
  return m === null ? '#VALUE!' : m.index + 1;
}

/** Excel SEARCH wildcards: * (any run), ? (one char), ~ escapes the next one. */
function wildcardToRegExp(pattern: string, flags: string): RegExp {
  let out = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i]!;
    if (ch === '~' && i + 1 < pattern.length) {
      const next = pattern[i + 1]!;
      out += /[.*+?^${}()|[\]\\]/.test(next) ? `\\${next}` : next;
      i += 1;
      continue;
    }
    if (ch === '*') { out += '.*'; continue; }
    if (ch === '?') { out += '.'; continue; }
    out += /[.*+?^${}()|[\]\\]/.test(ch) ? `\\${ch}` : ch;
  }
  return new RegExp(out, flags);
}

/** SUBSTITUTE(text, old, new, [instance]): instance is 1-based; empty old is a no-op. */
function substitute(s: string, oldText: string, rep: string, instanceV: FormulaValue | undefined): FormulaArgument {
  if (oldText === '') return s;
  if (instanceV === undefined) return s.split(oldText).join(rep);
  const instance = Number(instanceV);
  if (!Number.isInteger(instance) || instance < 1) return '#VALUE!';
  // Excel counts instances non-overlapping: "aaa" has ONE "aa" instance.
  let idx = -1;
  let searchFrom = 0;
  for (let n = 0; n < instance; n += 1) {
    idx = s.indexOf(oldText, searchFrom);
    if (idx === -1) return s;
    searchFrom = idx + oldText.length;
  }
  return s.slice(0, idx) + rep + s.slice(idx + oldText.length);
}

/** REPLACE(old, start, numChars, new): splice by 1-based position. */
function replaceAt(s: string, start: number, numChars: number, rep: string): FormulaArgument {
  if (!Number.isInteger(start) || start < 1 || !Number.isInteger(numChars) || numChars < 0) return '#VALUE!';
  return s.slice(0, start - 1) + rep + s.slice(start - 1 + numChars);
}

/** SUMPRODUCT: element-wise product over equal-length lists; text/blank → 0, booleans → 1/0. */
function sumProduct(args: FormulaArgument[]): FormulaArgument {
  if (args.some(isSparseRange)) {
    // Positional product over stored offsets; a position missing on one side
    // reads as blank on that side, which contributes 0 — what a dense null
    // contributed too.
    const group = criteriaGroup(args, false);
    let total = 0;
    for (const i of group.domainOffsets) {
      if (!group.domainHas(i)) continue;
      let product = 1;
      for (let k = 0; k < args.length; k += 1) product *= productTerm(group.at(k, i));
      total += product;
    }
    return total;
  }
  const lists = args.map((a) => flatten([a]).map(productTerm));
  const len = lists[0]?.length ?? 0;
  if (lists.some((l) => l.length !== len)) return '#VALUE!';
  let total = 0;
  for (let i = 0; i < len; i += 1) {
    let product = 1;
    for (const list of lists) product *= list[i] ?? 0;
    total += product;
  }
  return total;
}

function productTerm(v: FormulaValue | null | undefined): number {
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Date) return 0;
  return numericOf(v) ?? 0;
}

function median(values: number[]): FormulaArgument {
  if (values.length === 0) return '#NUM!';
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function largeSmall(values: number[], k: number, which: 'large' | 'small'): FormulaArgument {
  if (!Number.isInteger(k) || k < 1 || k > values.length) return '#NUM!';
  const sorted = [...values].sort((a, b) => (which === 'large' ? b - a : a - b));
  return sorted[k - 1]!;
}

/** STDEV.S/STDEV (sample, n-1) vs STDEV.P/STDEVP (population, n). */
function stdev(values: number[], kind: 'sample' | 'population'): FormulaArgument {
  const n = values.length;
  if (n === 0 || (kind === 'sample' && n < 2)) return '#DIV/0!';
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (kind === 'sample' ? n - 1 : n);
  return Math.sqrt(variance);
}

/** RANK.EQ / RANK: best (lowest) rank on ties; order 0/omitted = descending. */
function rankEq(value: FormulaValue | undefined, listV: FormulaArgument | undefined, orderV: FormulaValue | undefined): FormulaArgument {
  const n = numericOf(value);
  if (n === undefined) return '#N/A';
  const values = flatten(listV === undefined ? [] : [listV]).flatMap((v) => {
    const num = numericOf(v);
    return num === undefined ? [] : [num];
  });
  if (!values.some((v) => v === n)) return '#N/A';
  const descending = orderV === undefined || Number(orderV) === 0;
  const better = descending ? values.filter((v) => v > n).length : values.filter((v) => v < n).length;
  return better + 1;
}

/** MAXIFS / MINIFS(range, critRange1, crit1, …) — 0 when nothing matches (Excel). */
function maxMinIfs(args: FormulaArgument[], which: 'max' | 'min'): FormulaArgument {
  if (args.length < 3 || args.length % 2 === 0) return 0;
  const ranges: FormulaArgument[] = [args[0]!];
  const crits: (FormulaValue | undefined)[] = [];
  for (let i = 1; i + 1 < args.length; i += 2) {
    ranges.push(args[i]!);
    crits.push(first(args[i + 1]));
  }
  if (ranges.some(isSparseRange)) {
    const group = criteriaGroup(ranges, crits.some(matchesBlank));
    let best: number | undefined;
    for (const i of group.domainOffsets) {
      if (!group.domainHas(i)) continue;
      if (!groupMatches(group, ranges.length, crits, 1, i)) continue;
      const n = numericOf(group.at(0, i));
      if (n === undefined) continue;
      best = best === undefined ? n : (which === 'max' ? Math.max(best, n) : Math.min(best, n));
    }
    return best ?? 0;
  }
  const vals = flatten([args[0]!]);
  const pairs: { keys: FormulaValue[]; crit: FormulaValue | undefined }[] = [];
  for (let i = 1; i + 1 < args.length; i += 2) {
    pairs.push({ keys: flatten([args[i]!]), crit: first(args[i + 1]) });
  }
  let best: number | undefined;
  for (let i = 0; i < vals.length; i += 1) {
    if (!pairs.every((p) => matchesCriteria(p.keys[i] ?? null, p.crit))) continue;
    const n = numericOf(vals[i] ?? null);
    if (n === undefined) continue;
    best = best === undefined ? n : (which === 'max' ? Math.max(best, n) : Math.min(best, n));
  }
  return best ?? 0;
}

// --- Dynamic-array functions (FILTER / UNIQUE / SORT / SEQUENCE) ---
// They return a matrix: nested inside an aggregate it flattens to its
// row-major list; as a cell's own result the engine spills it over that
// extent. The evaluator hands a range reference to UNIQUE / SORT / FILTER
// with its row/column extent; any other list arrives as one column.

/** An argument as a row-major table: a matrix keeps its extent, a plain list is one column, a scalar one cell. */
interface Table { readonly rows: number; readonly cols: number; readonly data: readonly FormulaValue[] }

function tableOf(value: FormulaArgument | undefined): Table {
  if (value === undefined) return { rows: 0, cols: 0, data: [] };
  if (isMatrix(value)) return value;
  if (isFormulaList(value)) return { rows: value.length, cols: 1, data: value };
  // Unreachable through the evaluator (it refuses sparse ranges for the
  // tabular functions); direct registry callers see the stored cells.
  if (isSparseRange(value)) { const data = materializeStored(value); return { rows: data.length, cols: 1, data }; }
  return { rows: 1, cols: 1, data: [value] };
}

function includeTruthy(v: FormulaValue): boolean {
  return !(v === false || v === 0 || v === null || v === '');
}

/** Case-insensitive, type-aware key so UNIQUE matches like excelEquals. */
function uniqueKey(v: FormulaValue): string {
  if (typeof v === 'string') return `s:${v.toUpperCase()}`;
  if (typeof v === 'number') return `n:${v}`;
  if (typeof v === 'boolean') return `b:${v}`;
  if (v === null) return 'e';
  return `t:${String(v)}`;
}

/**
 * UNIQUE(array): the distinct rows of a table, shape kept. A single row is
 * deduplicated along itself and comes back as a row.
 */
function uniqueOf(value: FormulaArgument | undefined): FormulaArgument {
  const t = tableOf(value);
  if (t.rows === 0) return '#CALC!';
  const alongRow = t.rows === 1;
  const width = alongRow ? 1 : t.cols;
  const count = alongRow ? t.cols : t.rows;
  const seen = new Set<string>();
  const kept: FormulaValue[][] = [];
  for (let i = 0; i < count; i += 1) {
    const from = alongRow ? i : i * t.cols;
    const item = t.data.slice(from, from + width);
    const key = item.map(uniqueKey).join('\u0000');
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(item);
  }
  return alongRow ? matrix(1, kept.length, kept.flat()) : matrix(kept.length, t.cols, kept.flat());
}

/** Excel sort order: numbers, text, booleans, blanks; numbers numerically, text case-insensitively. */
function compareSortKeys(a: FormulaValue, b: FormulaValue): number {
  const rank = (v: FormulaValue): number => {
    if (typeof v === 'number') return 0;
    if (typeof v === 'string') return 1;
    if (typeof v === 'boolean') return 2;
    return 3;
  };
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const ta = a === null ? '' : String(a);
  const tb = b === null ? '' : String(b);
  return ta.localeCompare(tb, 'zh-Hans-CN', { sensitivity: 'base' });
}

/**
 * SORT(array, [sort_index], [sort_order], [by_col]): rows reordered by the
 * sort_index-th column (1-based), or columns by the sort_index-th row when
 * by_col is TRUE; the shape is kept and equal keys keep their order. A lone
 * negative second argument is the former `order` flag, so SORT(range, -1)
 * still sorts descending.
 */
function sortOf(args: readonly FormulaArgument[]): FormulaArgument {
  const t = tableOf(args[0]);
  if (t.rows === 0) return '#CALC!';
  const indexValue = args[1] === undefined ? 1 : Number(first(args[1]));
  const legacyDescend = args[2] === undefined && indexValue === -1;
  const orderValue = legacyDescend ? -1 : (args[2] === undefined ? 1 : Number(first(args[2])));
  const byCol = args[3] !== undefined && Boolean(first(args[3]));
  const sortIndex = legacyDescend ? 1 : indexValue;
  if (!Number.isInteger(sortIndex) || sortIndex < 1 || sortIndex > (byCol ? t.rows : t.cols)) return '#VALUE!';
  if (orderValue !== 1 && orderValue !== -1) return '#VALUE!';
  const lines = byCol ? t.cols : t.rows;
  const keyOf = (line: number): FormulaValue => (byCol
    ? t.data[(sortIndex - 1) * t.cols + line]
    : t.data[line * t.cols + sortIndex - 1]) ?? null;
  const sign = orderValue === -1 ? -1 : 1;
  const order = Array.from({ length: lines }, (_, i) => i).sort((a, b) => sign * compareSortKeys(keyOf(a), keyOf(b)));
  const out: FormulaValue[] = new Array(t.rows * t.cols);
  for (let y = 0; y < t.rows; y += 1) {
    for (let x = 0; x < t.cols; x += 1) {
      out[y * t.cols + x] = t.data[(byCol ? y : order[y] ?? 0) * t.cols + (byCol ? order[x] ?? 0 : x)] ?? null;
    }
  }
  return matrix(t.rows, t.cols, out);
}

/**
 * FILTER(array, include, [if_empty]): a one-column `include` picks rows, a
 * one-row one picks columns, and the result keeps the array's other extent
 * (FILTER(A1:B3, C1:C3=1) is n×2).
 */
function filterOf(data: FormulaArgument | undefined, mask: FormulaArgument | undefined, ifEmpty: FormulaArgument | undefined): FormulaArgument {
  const t = tableOf(data);
  const m = tableOf(mask);
  const byRow = m.cols === 1 && (m.rows === t.rows || m.rows === 1);
  const byCol = !byRow && m.rows === 1 && m.cols === t.cols;
  if (!byRow && !byCol) return '#VALUE!';
  const truthy = (i: number): boolean => includeTruthy(m.data[byRow ? (m.rows === 1 ? 0 : i) : i] ?? null);
  const kept: number[] = [];
  const count = byRow ? t.rows : t.cols;
  for (let i = 0; i < count; i += 1) if (truthy(i)) kept.push(i);
  if (kept.length === 0) {
    if (ifEmpty === undefined) return '#CALC!';
    return isMatrix(ifEmpty) || Array.isArray(ifEmpty) ? ifEmpty : first(ifEmpty) ?? '';
  }
  const width = byRow ? t.cols : t.rows;
  const out: FormulaValue[] = new Array(kept.length * width);
  for (let k = 0; k < kept.length; k += 1) {
    for (let j = 0; j < width; j += 1) {
      // Row-major either way: a kept row is a result row, a kept column a result column.
      out[byRow ? k * width + j : j * kept.length + k] = (byRow
        ? t.data[(kept[k] ?? 0) * t.cols + j]
        : t.data[j * t.cols + (kept[k] ?? 0)]) ?? null;
    }
  }
  return byRow ? matrix(kept.length, t.cols, out) : matrix(t.rows, kept.length, out);
}

function sequenceOf(args: FormulaArgument[]): FormulaArgument {
  const num = (value: FormulaArgument | undefined, fallback: number): number | undefined => {
    if (value === undefined) return fallback;
    const n = Number(Array.isArray(value) ? first(value) : value);
    return Number.isFinite(n) ? n : undefined;
  };
  const rows = num(args[0], 1);
  const cols = num(args[1], 1);
  const start = num(args[2], 1);
  const step = num(args[3], 1);
  if (rows === undefined || cols === undefined || start === undefined || step === undefined) return '#VALUE!';
  if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 1 || cols < 1) return '#VALUE!';
  const out: number[] = [];
  let current = start;
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      out.push(current);
      current += step;
    }
  }
  return matrix(rows, cols, out);
}

registry.register('UNIQUE', { minArgs: 1, maxArgs: 1, evaluate: ([array]) => uniqueOf(array) });
registry.register('SORT', { minArgs: 1, maxArgs: 4, evaluate: (args) => sortOf(args) });
registry.register('FILTER', { minArgs: 2, maxArgs: 3, evaluate: ([array, include, ifEmpty]) => filterOf(array, include, ifEmpty) });
registry.register('SEQUENCE', { minArgs: 1, maxArgs: 4, evaluate: (args) => sequenceOf(args) });
