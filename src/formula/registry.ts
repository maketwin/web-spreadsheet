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
registry.register('MAX', { minArgs: 1, maxArgs: 255, evaluate: (args) => Math.max(...numbers(args)) });
registry.register('MIN', { minArgs: 1, maxArgs: 255, evaluate: (args) => Math.min(...numbers(args)) });
registry.register('COUNT', { minArgs: 1, maxArgs: 255, evaluate: (args) => numbers(args).length });
registry.register('COUNTA', { minArgs: 1, maxArgs: 255, evaluate: (args) => flatten(args).filter((v) => v != null && v !== '').length });
registry.register('ROUND', { minArgs: 1, maxArgs: 2, evaluate: ([n, d]) => round(first(n), first(d)) });
registry.register('ABS', { minArgs: 1, maxArgs: 1, evaluate: ([n]) => Math.abs(Number(first(n))) });
registry.register('INT', { minArgs: 1, maxArgs: 1, evaluate: ([n]) => Math.floor(Number(first(n))) });
registry.register('MOD', { minArgs: 2, maxArgs: 2, evaluate: ([a, b]) => Number(first(a)) % Number(first(b)) });

registry.register('IF', { minArgs: 2, maxArgs: 3, evaluate: ([cond, t, f]) => first(cond) ? first(t) ?? null : first(f) ?? null });
registry.register('AND', { minArgs: 1, maxArgs: 255, evaluate: (args) => flatten(args).every(Boolean) });
registry.register('OR', { minArgs: 1, maxArgs: 255, evaluate: (args) => flatten(args).some(Boolean) });
registry.register('NOT', { minArgs: 1, maxArgs: 1, evaluate: ([v]) => !first(v) });

registry.register('CONCAT', { minArgs: 1, maxArgs: 255, evaluate: (args) => flatten(args).map(String).join('') });
registry.register('LEFT', { minArgs: 1, maxArgs: 2, evaluate: ([s, n]) => String(first(s)).slice(0, n !== undefined ? Number(first(n)) : 1) });
registry.register('RIGHT', { minArgs: 1, maxArgs: 2, evaluate: ([s, n]) => right(first(s), first(n)) });
registry.register('MID', { minArgs: 2, maxArgs: 3, evaluate: ([s, start, len]) => mid(first(s), first(start), first(len)) });
registry.register('LEN', { minArgs: 1, maxArgs: 1, evaluate: ([s]) => String(first(s)).length });
registry.register('UPPER', { minArgs: 1, maxArgs: 1, evaluate: ([s]) => String(first(s)).toUpperCase() });
registry.register('LOWER', { minArgs: 1, maxArgs: 1, evaluate: ([s]) => String(first(s)).toLowerCase() });
registry.register('TRIM', { minArgs: 1, maxArgs: 1, evaluate: ([s]) => String(first(s)).trim() });

registry.register('VLOOKUP', { minArgs: 3, maxArgs: 4, evaluate: () => null });
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
  return values.reduce<number>((total, value) => total + Number(value || 0), 0);
}

function average(values: FormulaValue[]): number {
  if (values.length === 0) return 0;
  return sum(values) / values.length;
}

function numbers(values: FormulaArgument[]): number[] {
  return flatten(values).map(Number);
}

function flatten(values: FormulaArgument[]): FormulaValue[] {
  return values.flatMap((value) => (Array.isArray(value) ? value : [value]));
}

function first(value: FormulaArgument | undefined): FormulaValue | undefined {
  if (value === undefined) return undefined;
  if (isFormulaList(value)) return value[0];
  return value;
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
