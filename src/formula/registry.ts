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

registry.register('NOW', { minArgs: 0, maxArgs: 0, evaluate: () => new Date() });
registry.register('TODAY', { minArgs: 0, maxArgs: 0, evaluate: () => new Date().toISOString().slice(0, 10) });
registry.register('YEAR', { minArgs: 1, maxArgs: 1, evaluate: ([d]) => toDate(first(d)).getFullYear() });
registry.register('MONTH', { minArgs: 1, maxArgs: 1, evaluate: ([d]) => toDate(first(d)).getMonth() + 1 });
registry.register('DAY', { minArgs: 1, maxArgs: 1, evaluate: ([d]) => toDate(first(d)).getDate() });
registry.register('HOUR', { minArgs: 1, maxArgs: 1, evaluate: ([d]) => toDate(first(d)).getHours() });

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

function numericOf(v: FormulaValue): number | undefined {
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
  return values.filter((entry) => String(entry) === String(criteria)).length;
}

function toDate(value: FormulaValue | undefined): Date {
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number') return new Date(value);
  return new Date('');
}
