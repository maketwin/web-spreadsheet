import type { FormulaArgument, FormulaValue } from './types';

export interface FunctionSpec {
  minArgs: number;
  maxArgs: number;
  evaluate: (args: FormulaArgument[]) => FormulaArgument;
}

class FunctionRegistry {
  private funcs = new Map<string, FunctionSpec>();

  register(name: string, spec: FunctionSpec): void {
    this.funcs.set(name.toUpperCase(), spec);
  }

  get(name: string): FunctionSpec | undefined {
    return this.funcs.get(name.toUpperCase());
  }

  has(name: string): boolean {
    return this.funcs.has(name.toUpperCase());
  }

  list(): string[] {
    return [...this.funcs.keys()];
  }
}

export const registry = new FunctionRegistry();

registry.register('SUM', { minArgs: 1, maxArgs: 255, evaluate: (args) => sum(flatten(args)) });
registry.register('AVERAGE', { minArgs: 1, maxArgs: 255, evaluate: (args) => average(flatten(args)) });
registry.register('MAX', { minArgs: 1, maxArgs: 255, evaluate: (args) => { const n = numbers(args); return n.length === 0 ? 0 : Math.max(...n); } });
registry.register('MIN', { minArgs: 1, maxArgs: 255, evaluate: (args) => { const n = numbers(args); return n.length === 0 ? 0 : Math.min(...n); } });
registry.register('COUNT', { minArgs: 1, maxArgs: 255, evaluate: (args) => numbers(args).length });
registry.register('COUNTA', { minArgs: 1, maxArgs: 255, evaluate: (args) => flatten(args).filter((v) => v != null && v !== '').length });
registry.register('ROUND', { minArgs: 1, maxArgs: 2, evaluate: ([n, d]) => round(first(n), first(d)) });
registry.register('ABS', { minArgs: 1, maxArgs: 1, evaluate: ([n]) => Math.abs(Number(first(n))) });
registry.register('INT', { minArgs: 1, maxArgs: 1, evaluate: ([n]) => Math.floor(Number(first(n))) });
registry.register('MOD', { minArgs: 2, maxArgs: 2, evaluate: ([a, b]) => mod(first(a), first(b)) });

// The evaluator intercepts IF for lazy branch evaluation; this body is only
// reached by direct registry callers and mirrors ifLazy's falsy list.
registry.register('IF', { minArgs: 2, maxArgs: 3, evaluate: ([cond, t, f]) => {
  const c = first(cond);
  return (c === false || c === 0 || c === null || c === '') ? first(f) ?? null : first(t) ?? null;
} });
registry.register('AND', { minArgs: 1, maxArgs: 255, evaluate: (args) => flatten(args).every(Boolean) });
registry.register('OR', { minArgs: 1, maxArgs: 255, evaluate: (args) => flatten(args).some(Boolean) });
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
registry.register('ISBLANK', { minArgs: 1, maxArgs: 1, evaluate: ([v]) => first(v) === null || first(v) === undefined || first(v) === '' });
registry.register('ISNUMBER', { minArgs: 1, maxArgs: 1, evaluate: ([v]) => typeof first(v) === 'number' && Number.isFinite(first(v) as number) });
registry.register('ISTEXT', { minArgs: 1, maxArgs: 1, evaluate: ([v]) => typeof first(v) === 'string' && !isExcelError(first(v)) });
registry.register('ISERROR', { minArgs: 1, maxArgs: 1, evaluate: ([v]) => isExcelError(first(v)) });
registry.register('ISNA', { minArgs: 1, maxArgs: 1, evaluate: ([v]) => first(v) === '#N/A' });

registry.register('NOW', { minArgs: 0, maxArgs: 0, evaluate: () => new Date() });
registry.register('TODAY', { minArgs: 0, maxArgs: 0, evaluate: () => new Date().toISOString().slice(0, 10) });
registry.register('DATE', { minArgs: 3, maxArgs: 3, evaluate: ([y, m, d]) => dateOf(first(y), first(m), first(d)) });
registry.register('TIME', { minArgs: 3, maxArgs: 3, evaluate: ([h, m, s]) => timeOf(first(h), first(m), first(s)) });
registry.register('DATEDIF', { minArgs: 3, maxArgs: 3, evaluate: ([a, b, unit]) => dateDif(first(a), first(b), text(first(unit))) });
registry.register('YEAR', { minArgs: 1, maxArgs: 1, evaluate: ([d]) => toDate(first(d)).getFullYear() });
registry.register('MONTH', { minArgs: 1, maxArgs: 1, evaluate: ([d]) => toDate(first(d)).getMonth() + 1 });
registry.register('DAY', { minArgs: 1, maxArgs: 1, evaluate: ([d]) => toDate(first(d)).getDate() });
registry.register('HOUR', { minArgs: 1, maxArgs: 1, evaluate: ([d]) => toDate(first(d)).getHours() });

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

function sum(values: FormulaValue[]): number {
  // Excel SUM ignores real text and empty cells inside ranges (errors already
  // propagated at the evaluator level); numeric-looking text coerces.
  return values.reduce<number>((total, value) => total + (numericOf(value) ?? 0), 0);
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
  return values.flatMap((value) => (Array.isArray(value) ? value : [value]));
}

function first(value: FormulaArgument | undefined): FormulaValue | undefined {
  if (value === undefined) return undefined;
  if (isFormulaList(value)) return value[0];
  return value;
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

function round(n: FormulaValue | undefined, d: FormulaValue | undefined): number {
  const factor = Math.pow(10, d !== undefined ? Number(d) : 0);
  return Math.round(Number(n) * factor) / factor;
}

function right(s: FormulaValue | undefined, n: FormulaValue | undefined): string {
  return String(s).slice(-(n !== undefined ? Number(n) : 1));
}

function mid(s: FormulaValue | undefined, start: FormulaValue | undefined, len: FormulaValue | undefined): string {
  const from = Number(start) - 1;
  return String(s).slice(from, len !== undefined ? from + Number(len) : undefined);
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
  const values = value === undefined ? [] : flatten([value]);
  return values.filter((entry) => matchesCriteria(entry, criteria)).length;
}

function sumIf(range: FormulaArgument | undefined, criteria: FormulaValue | undefined, sumRange: FormulaArgument | undefined): number {
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


function averageIf(range: FormulaArgument | undefined, criteria: FormulaValue | undefined, avgRange: FormulaArgument | undefined): FormulaArgument {
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

/** Excel-ish criteria: ">5", ">=10", "<>a", exact / case-insensitive text. */
function matchesCriteria(value: FormulaValue | undefined, criteria: FormulaValue | undefined): boolean {
  if (criteria === undefined || criteria === null) return value === null || value === undefined || value === '';
  const crit = String(criteria);
  const ops = ['>=', '<=', '<>', '>', '<', '='] as const;
  for (const op of ops) {
    if (crit.startsWith(op)) return compareCriteria(value, crit.slice(op.length), op);
  }
  return compareCriteria(value, crit, '=');
}

function compareCriteria(value: FormulaValue | undefined, rhsRaw: string, op: string): boolean {
  const rhsNum = Number(rhsRaw);
  const lhsNum = typeof value === 'number' ? value : Number(value);
  const bothNum = Number.isFinite(rhsNum) && Number.isFinite(lhsNum) && String(value ?? '').trim() !== '';
  if (bothNum) {
    switch (op) {
      case '>': return lhsNum > rhsNum;
      case '<': return lhsNum < rhsNum;
      case '>=': return lhsNum >= rhsNum;
      case '<=': return lhsNum <= rhsNum;
      case '<>': return lhsNum !== rhsNum;
      default: return lhsNum === rhsNum;
    }
  }
  const lhs = String(value ?? '').toLowerCase();
  const rhs = rhsRaw.toLowerCase();
  switch (op) {
    case '>': return lhs > rhs;
    case '<': return lhs < rhs;
    case '>=': return lhs >= rhs;
    case '<=': return lhs <= rhs;
    case '<>': return lhs !== rhs;
    default: return lhs === rhs;
  }
}

function isExcelError(v: FormulaValue | undefined): boolean {
  return typeof v === 'string' && ['#NULL!', '#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#NUM!', '#N/A'].includes(v);
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

/** Minimal TEXT: 0 / 0.00 / #,##0 / General. */
function textFormat(v: FormulaValue | undefined, fmt: FormulaValue | undefined): string {
  const pattern = String(fmt ?? 'General');
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


function toDate(value: FormulaValue | undefined): Date {
  if (value instanceof Date) return value;
  // Bare time strings ("13:30") don't parse in every engine — anchor them.
  if (typeof value === 'string' && /^\d{1,2}:\d{2}(:\d{2})?$/.test(value.trim())) return new Date(`1970-01-01T${value.trim()}`);
  if (typeof value === 'string' || typeof value === 'number') return new Date(value);
  return new Date('');
}

/** DATE(y, m, d): Excel normalizes month/day overflow via calendar arithmetic. */
function dateOf(y: FormulaValue | undefined, m: FormulaValue | undefined, d: FormulaValue | undefined): FormulaArgument {
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return '#VALUE!';
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() < 0 || dt.getUTCFullYear() > 9999) return '#NUM!';
  return dt.toISOString().slice(0, 10);
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
    const target = new Date(base.getFullYear(), base.getMonth() + months, 1);
    const lastDay = new Date(base.getFullYear(), base.getMonth() + months + 1, 0).getDate();
    target.setDate(Math.min(base.getDate(), lastDay));
    return target;
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
