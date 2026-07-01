import type { FormulaValue } from './types';

export interface FunctionSpec {
  minArgs: number;
  maxArgs: number;
  evaluate: (args: FormulaValue[]) => FormulaValue;
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
registry.register('MAX', { minArgs: 1, maxArgs: 255, evaluate: (args) => Math.max(...flatten(args).map(Number)) });
registry.register('MIN', { minArgs: 1, maxArgs: 255, evaluate: (args) => Math.min(...flatten(args).map(Number)) });
registry.register('COUNT', { minArgs: 1, maxArgs: 255, evaluate: (args) => flatten(args).filter((v): v is number => typeof v === 'number').length });
registry.register('COUNTA', { minArgs: 1, maxArgs: 255, evaluate: (args) => flatten(args).filter((v) => v != null && v !== '').length });
registry.register('ROUND', { minArgs: 1, maxArgs: 2, evaluate: ([n, d]) => round(n, d) });
registry.register('ABS', { minArgs: 1, maxArgs: 1, evaluate: ([n]) => Math.abs(Number(n)) });
registry.register('INT', { minArgs: 1, maxArgs: 1, evaluate: ([n]) => Math.floor(Number(n)) });
registry.register('MOD', { minArgs: 2, maxArgs: 2, evaluate: ([a, b]) => Number(a) % Number(b) });

registry.register('IF', { minArgs: 2, maxArgs: 3, evaluate: ([cond, t, f]) => (cond ? t ?? null : f ?? null) });
registry.register('AND', { minArgs: 1, maxArgs: 255, evaluate: (args) => flatten(args).every(Boolean) });
registry.register('OR', { minArgs: 1, maxArgs: 255, evaluate: (args) => flatten(args).some(Boolean) });
registry.register('NOT', { minArgs: 1, maxArgs: 1, evaluate: ([v]) => !v });

registry.register('CONCAT', { minArgs: 1, maxArgs: 255, evaluate: (args) => flatten(args).map(String).join('') });
registry.register('LEFT', { minArgs: 1, maxArgs: 2, evaluate: ([s, n]) => String(s).slice(0, n !== undefined ? Number(n) : 1) });
registry.register('RIGHT', { minArgs: 1, maxArgs: 2, evaluate: ([s, n]) => right(s, n) });
registry.register('MID', { minArgs: 2, maxArgs: 3, evaluate: ([s, start, len]) => mid(s, start, len) });
registry.register('LEN', { minArgs: 1, maxArgs: 1, evaluate: ([s]) => String(s).length });
registry.register('UPPER', { minArgs: 1, maxArgs: 1, evaluate: ([s]) => String(s).toUpperCase() });
registry.register('LOWER', { minArgs: 1, maxArgs: 1, evaluate: ([s]) => String(s).toLowerCase() });
registry.register('TRIM', { minArgs: 1, maxArgs: 1, evaluate: ([s]) => String(s).trim() });

registry.register('VLOOKUP', { minArgs: 3, maxArgs: 4, evaluate: () => null });
registry.register('INDEX', { minArgs: 2, maxArgs: 3, evaluate: ([arr, row]) => valueAt(arr, Number(row) - 1) });
registry.register('MATCH', { minArgs: 2, maxArgs: 3, evaluate: ([search, arr]) => matchIndex(search, arr) });
registry.register('COUNTIF', { minArgs: 2, maxArgs: 2, evaluate: ([arr, criteria]) => countIf(arr, criteria) });

registry.register('NOW', { minArgs: 0, maxArgs: 0, evaluate: () => new Date() });
registry.register('TODAY', { minArgs: 0, maxArgs: 0, evaluate: () => new Date().toISOString().slice(0, 10) });
registry.register('YEAR', { minArgs: 1, maxArgs: 1, evaluate: ([d]) => toDate(d).getFullYear() });
registry.register('MONTH', { minArgs: 1, maxArgs: 1, evaluate: ([d]) => toDate(d).getMonth() + 1 });
registry.register('DAY', { minArgs: 1, maxArgs: 1, evaluate: ([d]) => toDate(d).getDate() });
registry.register('HOUR', { minArgs: 1, maxArgs: 1, evaluate: ([d]) => toDate(d).getHours() });

function sum(values: FormulaValue[]): number {
  return values.reduce<number>((total, value) => total + Number(value || 0), 0);
}

function average(values: FormulaValue[]): number {
  if (values.length === 0) return 0;
  return sum(values) / values.length;
}

function round(n: FormulaValue | undefined, d: FormulaValue | undefined): number {
  const num = Number(n);
  const dec = d !== undefined ? Number(d) : 0;
  const factor = Math.pow(10, dec);
  return Math.round(num * factor) / factor;
}

function right(s: FormulaValue | undefined, n: FormulaValue | undefined): string {
  const str = String(s);
  const num = n !== undefined ? Number(n) : 1;
  return str.slice(-num);
}

function mid(s: FormulaValue | undefined, start: FormulaValue | undefined, len: FormulaValue | undefined): string {
  const from = Number(start) - 1;
  return String(s).slice(from, len !== undefined ? from + Number(len) : undefined);
}

function valueAt(value: FormulaValue | undefined, index: number): FormulaValue {
  return index === 0 ? value ?? null : null;
}

function matchIndex(search: FormulaValue | undefined, value: FormulaValue | undefined): number {
  return value === search ? 1 : 0;
}

function countIf(value: FormulaValue | undefined, criteria: FormulaValue | undefined): number {
  return String(value) === String(criteria) ? 1 : 0;
}

function toDate(value: FormulaValue | undefined): Date {
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number') return new Date(value);
  return new Date('');
}

function flatten(arr: FormulaValue[]): FormulaValue[] {
  return arr.filter((v) => v !== undefined);
}
