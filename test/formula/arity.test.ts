import { describe, expect, it } from 'vitest';
import { FormulaParser } from '../../src/formula/parser';
import { evaluate } from '../../src/formula/evaluator';
import { registry } from '../../src/formula/registry';
import { isMatrix } from '../../src/formula/types';
import type { CellResolver, FormulaValue } from '../../src/formula/types';

const parser = new FormulaParser();

/** Evaluate `=expr` with A1-style cells served from `cells`; arrays report their first element. */
function calc(expr: string, cells: Record<string, FormulaValue> = {}): FormulaValue {
  const ast = parser.parse(expr);
  if (ast === null) throw new Error(`parse failed: ${expr}`);
  const resolve: CellResolver = (x, y) => cells[`${String.fromCharCode(65 + x)}${y + 1}`] ?? null;
  const result = evaluate(ast, resolve);
  return (Array.isArray(result) ? (result[0] ?? null) : result) as FormulaValue;
}

const nums: Record<string, FormulaValue> = { A1: 3, A2: 1, A3: 2 };

/** `rows×cols` of a formula's matrix result (-1 for a scalar). */
const shape = (expr: string): { rows: number; cols: number } => {
  const m = evaluate(parser.parse(expr)!, (x, y) => nums[`${String.fromCharCode(65 + x)}${y + 1}`] ?? null);
  return isMatrix(m) ? { rows: m.rows, cols: m.cols } : { rows: -1, cols: -1 };
};

describe('argument-count check (the registry declares minArgs / maxArgs)', () => {
  it('too few arguments is an error value, never a silent default', () => {
    expect(calc('=SUM()')).toBe('#VALUE!'); // used to read as 0
    for (const fn of ['AVERAGE', 'MAX', 'MIN', 'COUNT', 'COUNTA', 'PRODUCT', 'SUMPRODUCT', 'MEDIAN', 'CONCAT']) {
      expect(calc(`=${fn}()`), fn).toBe('#VALUE!');
    }
    expect(calc('=ABS()')).toBe('#VALUE!');
    expect(calc('=MOD(1)')).toBe('#VALUE!');
    expect(calc('=TEXT(1)')).toBe('#VALUE!');
    expect(calc('=COUNTIF(A1:A3)')).toBe('#VALUE!');
    expect(calc('=SUMIF(A1:A3)')).toBe('#VALUE!');
    expect(calc('=DATE(2024,1)')).toBe('#VALUE!');
    expect(calc('=EXACT("a")')).toBe('#VALUE!');
    expect(calc('=SQRT()')).toBe('#VALUE!');
    expect(calc('=LEN()')).toBe('#VALUE!');
    expect(calc('=ISERROR()')).toBe('#VALUE!');
    expect(calc('=SEQUENCE()')).toBe('#VALUE!');
  });

  it('too many arguments is an error value instead of being dropped', () => {
    expect(calc('=ABS(1,2)')).toBe('#VALUE!');
    expect(calc('=SQRT(9,1)')).toBe('#VALUE!');
    expect(calc('=LEN("a","b")')).toBe('#VALUE!');
    expect(calc('=LEFT("abc",1,1)')).toBe('#VALUE!');
    expect(calc('=TEXT(1,"0","x")')).toBe('#VALUE!');
    expect(calc('=MOD(7,4,1)')).toBe('#VALUE!');
    expect(calc('=PI(1)')).toBe('#VALUE!');
    expect(calc('=NOW(1)')).toBe('#VALUE!');
    expect(calc('=TODAY(1)')).toBe('#VALUE!');
    expect(calc('=COUNTIF(A1:A3,">0",1)')).toBe('#VALUE!');
    expect(calc('=DATE(2024,1,1,1)')).toBe('#VALUE!');
    expect(calc('=UNIQUE(A1:A3,TRUE)')).toBe('#VALUE!');
  });

  it('keeps every call the declarations allow', () => {
    expect(calc('=SUM(1)')).toBe(1);
    expect(calc('=SUM(1,2,3)', {})).toBe(6);
    expect(calc('=ROUND(1.234)')).toBe(1); // digits optional
    expect(calc('=ROUNDUP(1.21)')).toBe(2);
    expect(calc('=ROUNDDOWN(1.29)')).toBe(1);
    expect(calc('=LEFT("abc")')).toBe('a');
    expect(calc('=RIGHT("abc")')).toBe('c');
    expect(calc('=MID("abcd",2)')).toBe('bcd'); // this build reads a missing length as "to the end"
    expect(calc('=FIND("b","abc")')).toBe(2);
    expect(calc('=SUBSTITUTE("aaa","a","b")')).toBe('bbb');
    expect(calc('=SUMIF(A1:A3,">1")', nums)).toBe(5);
    expect(calc('=AVERAGEIF(A1:A3,">1")', nums)).toBe(2.5);
    expect(calc('=RANK(2,A1:A3)', nums)).toBe(2);
    expect(calc('=TEXTJOIN(",",TRUE,"a")')).toBe('a');
    expect(calc('=CONCATENATE("a")')).toBe('a');
    expect(calc('=IFERROR(1/0)')).toBeNull(); // blank on error, as before
    expect(shape('=SEQUENCE(2)')).toEqual({ rows: 2, cols: 1 });
    expect(shape('=UNIQUE(A1:A3)')).toEqual({ rows: 3, cols: 1 });
  });

  it('SUM still accepts its documented maximum of 255 arguments', () => {
    const args = (n: number): string => Array(n).fill('1').join(',');
    expect(calc(`=SUM(${args(255)})`)).toBe(255);
    expect(calc(`=SUM(${args(256)})`)).toBe('#VALUE!');
  });

  it('applies to functions a plugin registers later', () => {
    registry.register('PLUGIN.DOUBLE', { minArgs: 1, maxArgs: 1, evaluate: ([v]) => Number(v) * 2 });
    expect(calc('=PLUGIN.DOUBLE(4)')).toBe(8);
    expect(calc('=PLUGIN.DOUBLE()')).toBe('#VALUE!');
    expect(calc('=PLUGIN.DOUBLE(1,2)')).toBe('#VALUE!');
  });
});

describe('argument-count check for the functions the evaluator handles itself', () => {
  const table = { B1: 'a', C1: 10, B2: 'b', C2: 20 };

  it('too few arguments is an error value instead of a blank', () => {
    expect(calc('=IF()')).toBe('#VALUE!');
    expect(calc('=IF(TRUE)')).toBe('#VALUE!'); // Excel wants value_if_true
    expect(calc('=VLOOKUP(A1)')).toBe('#VALUE!'); // used to read as blank
    expect(calc('=VLOOKUP("a",B1:C2)')).toBe('#VALUE!');
    expect(calc('=HLOOKUP("a",B1:C1)')).toBe('#VALUE!');
    expect(calc('=XLOOKUP("a",B1:B2)')).toBe('#VALUE!');
    expect(calc('=SUBTOTAL(9)')).toBe('#VALUE!');
    expect(calc('=ROWS()')).toBe('#VALUE!');
    expect(calc('=COLUMNS()')).toBe('#VALUE!');
    expect(calc('=OFFSET(B1,1)')).toBe('#VALUE!');
    expect(calc('=SWITCH(A1,"a")')).toBe('#VALUE!');
    expect(calc('=IFS(TRUE)')).toBe('#VALUE!');
  });

  it('too many arguments is an error value', () => {
    expect(calc('=IF(TRUE,1,2,3)')).toBe('#VALUE!');
    expect(calc('=INDEX(B1:B2,1,1,1)')).toBe('#VALUE!');
    expect(calc('=VLOOKUP("b",B1:C2,2,0,5)', table)).toBe('#VALUE!');
    expect(calc('=ROWS(B1:B2,B2:B3)')).toBe('#VALUE!');
    expect(calc('=ROW(B1,B2)')).toBe('#VALUE!');
  });

  it('keeps the optional arguments optional', () => {
    expect(calc('=IF(TRUE,1)')).toBe(1); // Excel: value_if_false may be omitted
    expect(calc('=IF(FALSE,1)')).toBe(false);
    expect(calc('=IFERROR(1/0)')).toBeNull();
    expect(calc('=IFNA(1)')).toBe(1);
    expect(calc('=ROW()')).toBe(1);
    expect(calc('=COLUMN()')).toBe(1);
    expect(calc('=INDIRECT("B2")', table)).toBe('b');
    expect(calc('=INDIRECT("B2",TRUE)', table)).toBe('b');
    expect(calc('=OFFSET(B1,1,1)', table)).toBe(20);
    expect(calc('=OFFSET(B1,0,0,2,1)', table)).toBe('a'); // first cell of the 2×1 block
    expect(calc('=SUM(OFFSET(B1,0,1,2,1))', table)).toBe(30);
    expect(calc('=XLOOKUP("b",B1:B2,C1:C2,,,1)', table)).toBe(20); // empty placeholders count as arguments
    expect(calc('=MATCH("b",B1:B2)', table)).toBe(2);
    expect(calc('=INDEX(B1:C2,2,2)', table)).toBe(20);
    expect(calc('=SUBTOTAL(9,A1:A3)', nums)).toBe(6);
  });
});
