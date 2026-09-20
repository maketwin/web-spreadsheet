import { describe, expect, it } from 'vitest';
import { FormulaParser } from '../../src/formula/parser';
import { evaluate } from '../../src/formula/evaluator';
import type { FormulaValue } from '../../src/formula/types';

const parser = new FormulaParser();

function calc(formula: string, cells: Record<string, FormulaValue> = {}): FormulaValue {
  const ast = parser.parse(formula);
  if (ast === null) throw new Error(`parse failed: ${formula}`);
  const resolve = (x: number, y: number): FormulaValue => {
    const key = `${String.fromCharCode(65 + x)}${y + 1}`;
    return cells[key] ?? null;
  };
  const result = evaluate(ast, resolve);
  return (Array.isArray(result) ? (result[0] ?? null) : result) as FormulaValue;
}

describe('high-frequency Excel functions', () => {
  it('SUMIF / COUNTIF with operators', () => {
    expect(calc('=SUMIF(A1:A3,">1")', { A1: 1, A2: 2, A3: 3 })).toBe(5);
    expect(calc('=COUNTIF(A1:A3,">=2")', { A1: 1, A2: 2, A3: 3 })).toBe(2);
  });

  it('SUMIFS / COUNTIFS', () => {
    expect(calc('=SUMIFS(C1:C3,A1:A3,">1",B1:B3,"x")', {
      A1: 1, A2: 2, A3: 3, B1: 'x', B2: 'x', B3: 'y', C1: 10, C2: 20, C3: 30,
    })).toBe(20);
    expect(calc('=COUNTIFS(A1:A3,">1",B1:B3,"x")', {
      A1: 1, A2: 2, A3: 3, B1: 'x', B2: 'x', B3: 'y',
    })).toBe(1);
  });

  it('IFERROR / IFNA', () => {
    expect(calc('=IFERROR(1/0,42)')).toBe(42);
    expect(calc('=IFERROR(2+2,0)')).toBe(4);
    expect(calc('=IFNA(1/0,9)')).toBe('#DIV/0!'); // only traps #N/A
  });

  it('VALUE / ROUNDUP / POWER / SQRT / PI', () => {
    expect(calc('=VALUE("12")')).toBe(12);
    expect(calc('=ROUNDUP(1.21,1)')).toBe(1.3);
    expect(calc('=POWER(2,3)')).toBe(8);
    expect(calc('=SQRT(9)')).toBe(3);
    expect(calc('=SQRT(-1)')).toBe('#NUM!');
    expect(calc('=PI()')).toBeCloseTo(Math.PI);
  });

  it('IS* helpers', () => {
    expect(calc('=ISBLANK(A1)', {})).toBe(true);
    expect(calc('=ISNUMBER(A1)', { A1: 3 })).toBe(true);
    expect(calc('=ISTEXT(A1)', { A1: 'hi' })).toBe(true);
    expect(calc('=ISERROR(A1)', { A1: '#DIV/0!' })).toBe(true);
  });

  it('TEXT / CONCATENATE', () => {
    expect(calc('=TEXT(1.2,"0.00")')).toBe('1.20');
    expect(calc('=CONCATENATE("a","b")')).toBe('ab');
  });
});
