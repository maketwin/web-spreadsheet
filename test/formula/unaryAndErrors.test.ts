import { describe, expect, it } from 'vitest';
import { evaluate } from '../../src/formula/evaluator';
import { FormulaParser } from '../../src/formula/parser';
import type { CellResolver } from '../../src/formula/types';

const parser = new FormulaParser();

/** Evaluate `=expr` with A1-style cells served from `cells` (0-based r,c keys). */
function calc(expr: string, cells: Readonly<Record<string, unknown>> = {}): unknown {
  const ast = parser.parse(expr);
  if (ast === null) throw new Error(`parse failed: ${expr}`);
  const resolver: CellResolver = (x, y) => {
    const key = `${String.fromCharCode(65 + x)}${y + 1}`;
    return (cells[key] ?? null) as never;
  };
  const value = evaluate(ast, resolver);
  return Array.isArray(value) ? value[0] : value;
}

describe('unary operators (Excel parity)', () => {
  it('negates a cell reference', () => {
    expect(calc('=-A1', { A1: 5 })).toBe(-5);
  });

  it('negates a parenthesized group', () => {
    expect(calc('=-(A1+2)', { A1: 3 })).toBe(-5);
  });

  it('binds unary tighter than binary + (Excel: -A1+1 = (-A1)+1)', () => {
    expect(calc('=-A1+1', { A1: 2 })).toBe(-1);
  });

  it('evaluates a unary sign after a binary operator', () => {
    expect(calc('=2*-3')).toBe(-6);
    expect(calc('=2 * -3')).toBe(-6);
    expect(calc('=3--2')).toBe(5);
    expect(calc('=3 - -2')).toBe(5);
  });

  it('chains unary signs', () => {
    expect(calc('=--3')).toBe(3);
    expect(calc('=-A1', { A1: -4 })).toBe(4);
  });

  it('keeps unary inside function arguments', () => {
    expect(calc('=SUM(-A1, -2)', { A1: 5 })).toBe(-7);
  });

  it('propagates errors and coerces text through unary minus', () => {
    expect(calc('=-A1', { A1: '#DIV/0!' })).toBe('#DIV/0!');
    expect(calc('=-A1', { A1: 'abc' })).toBe('#VALUE!');
  });
});

describe('power operator', () => {
  it('computes ^ with Excel precedence (-2^2 = 4)', () => {
    expect(calc('=2^3')).toBe(8);
    expect(calc('=-2^2')).toBe(4);
    expect(calc('=2^-2')).toBe(0.25);
  });

  it('is left-associative like Excel', () => {
    expect(calc('=2^3^2')).toBe(64);
  });

  it('maps 0^0 to #NUM!', () => {
    expect(calc('=0^0')).toBe('#NUM!');
  });
});

describe('boolean literals', () => {
  it('resolves TRUE/FALSE case-insensitively', () => {
    expect(calc('=TRUE')).toBe(true);
    expect(calc('=false')).toBe(false);
  });

  it('drives IF without a cell reference', () => {
    expect(calc('=IF(TRUE,1,2)')).toBe(1);
    expect(calc('=IF(FALSE,1,2)')).toBe(2);
  });
});

describe('function error discipline (Excel parity)', () => {
  it('returns #NAME? for unknown functions and names', () => {
    expect(calc('=NOSUCHFN(1)')).toBe('#NAME?');
    expect(calc('=Sales_Total')).toBe('#NAME?');
  });

  it('propagates error arguments out of function calls', () => {
    expect(calc('=SUM(A1:A3)', { A1: 1, A2: '#DIV/0!', A3: 2 })).toBe('#DIV/0!');
    expect(calc('=ABS(A1)', { A1: '#N/A' })).toBe('#N/A');
  });

  it('does not propagate an error in an IF branch that is not taken', () => {
    expect(calc('=IF(TRUE,1,A1)', { A1: '#DIV/0!' })).toBe(1);
  });

  it('propagates an error in the IF condition', () => {
    expect(calc('=IF(A1,1,2)', { A1: '#N/A' })).toBe('#N/A');
  });

  it('SUM ignores text in ranges instead of leaking NaN', () => {
    expect(calc('=SUM(A1:A3)', { A1: 10, A2: 'abc', A3: 5 })).toBe(15);
  });

  it('COUNT counts only numeric cells', () => {
    expect(calc('=COUNT(A1:A4)', { A1: 10, A2: 'abc', A5: 1 })).toBe(1);
  });

  it('MAX/MIN ignore text and yield 0 over an empty set', () => {
    expect(calc('=MAX(A1:A2)', { A1: 'x', A2: 'y' })).toBe(0);
    expect(calc('=MIN(A1:A2)', { A1: 'x' })).toBe(0);
    expect(calc('=MAX(A1:A2)', { A1: 3, A2: 9 })).toBe(9);
  });

  it('AVERAGE over no numbers is #DIV/0!', () => {
    expect(calc('=AVERAGE(A1:A2)', { A1: 'x' })).toBe('#DIV/0!');
  });

  it('MOD follows Excel semantics (sign of divisor, #DIV/0! on zero)', () => {
    expect(calc('=MOD(3,0)')).toBe('#DIV/0!');
    expect(calc('=MOD(-3,5)')).toBe(2);
    expect(calc('=MOD(3,-5)')).toBe(-2);
    expect(calc('=MOD(7,4)')).toBe(3);
  });

  it('maps a NaN function result to #VALUE! instead of leaking NaN', () => {
    expect(calc('=ABS(A1)', { A1: 'abc' })).toBe('#VALUE!');
  });
});

describe('text function coercion', () => {
  it('treats empty cells as empty strings, not "null"', () => {
    expect(calc('=LEN(A1)')).toBe(0);
    expect(calc('=A1&"x"')).toBe('x');
    expect(calc('=CONCAT(A1,A2)')).toBe('');
    expect(calc('=UPPER(A1)')).toBe('');
  });
});
