import { describe, expect, it } from 'vitest';
import { FormulaParser } from '../../src/formula/parser';
import { evaluate } from '../../src/formula/evaluator';
import type { CellResolver, FormulaValue } from '../../src/formula/types';

const parser = new FormulaParser();

/** Evaluate `=expr` with A1-style cells served from `cells` (absent keys are blank cells). */
function calc(expr: string, cells: Record<string, FormulaValue> = {}): FormulaValue {
  const ast = parser.parse(expr);
  if (ast === null) throw new Error(`parse failed: ${expr}`);
  const resolve: CellResolver = (x, y) => cells[`${String.fromCharCode(65 + x)}${y + 1}`] ?? null;
  const result = evaluate(ast, resolve);
  return (Array.isArray(result) ? (result[0] ?? null) : result) as FormulaValue;
}

describe('COUNTIF criteria — blanks', () => {
  it('an empty range satisfies no comparison (Excel: 0, not 5)', () => {
    for (const criteria of ['<5', '<=5', '>5', '>=5', '=5', '<>5', '<>x', '>a', '<a']) {
      expect(calc(`=COUNTIF(A2:A6,"${criteria}")`), criteria).toBe(0);
    }
  });

  it('only "" and "=" select blanks, and "<>" selects everything else', () => {
    expect(calc('=COUNTIF(A2:A6,"")')).toBe(5);
    expect(calc('=COUNTIF(A2:A6,"=")')).toBe(5);
    expect(calc('=COUNTIF(A2:A6,"<>")')).toBe(0);
    const mixed = { A1: 3, A3: 'x', A4: 10 };
    expect(calc('=COUNTIF(A1:A5,"")', mixed)).toBe(2);
    expect(calc('=COUNTIF(A1:A5,"<>")', mixed)).toBe(3);
  });

  it('a blank inside a mixed range is left out of every comparison', () => {
    const cells = { A1: 3, A3: 'x', A4: 10, A5: '5' };
    expect(calc('=COUNTIF(A1:A5,"<5")', cells)).toBe(1); // 3 only: "5" coerces and is not < 5
    expect(calc('=COUNTIF(A1:A5,">=5")', cells)).toBe(2); // 10 and the numeric text "5"
    expect(calc('=COUNTIF(A1:A5,"<>x")', cells)).toBe(3); // blanks never satisfy "<>"
    expect(calc('=COUNTIF(A1:A5,5)', cells)).toBe(1);
    expect(calc('=COUNTIF(A1:A5,"x")', cells)).toBe(1);
  });

  it('a numeric criterion compares numbers only; text ordering compares text only', () => {
    const cells = { A1: 5, A2: 'abc', A3: 10, A4: 'a', A5: 'c' };
    expect(calc('=COUNTIF(A1:A5,">1")', cells)).toBe(2);
    expect(calc('=COUNTIF(A1:A5,"<b")', cells)).toBe(2); // "abc" and "a": 5 and 10 are not text
    expect(calc('=COUNTIF(A1:A5,"<>5")', cells)).toBe(4); // every non-blank cell that is not 5
  });
});

describe('COUNTIF criteria — text matching', () => {
  const fruit = { A1: 'Apple', A2: 'banana', A3: 'avocado', A4: 7 };
  const stars = { A1: 'a*b', A2: 'axb', A3: 'a?b', A4: 'a~b' };

  it('matches case-insensitively', () => {
    expect(calc('=COUNTIF(A1:A4,"APPLE")', fruit)).toBe(1);
    expect(calc('=COUNTIF(A1:A4,"apple")', fruit)).toBe(1);
  });

  it('supports * and ? wildcards', () => {
    expect(calc('=COUNTIF(A1:A4,"a*")', fruit)).toBe(2);
    expect(calc('=COUNTIF(A1:A4,"?anana")', fruit)).toBe(1);
    expect(calc('=COUNTIF(A1:A4,"*an*")', fruit)).toBe(1); // banana
    expect(calc('=COUNTIF(A1:A4,"*")', fruit)).toBe(3); // text cells only, the number is left out
  });

  it('treats ~ as the wildcard escape', () => {
    expect(calc('=COUNTIF(A1:A4,"a~*b")', stars)).toBe(1);
    expect(calc('=COUNTIF(A1:A4,"a~?b")', stars)).toBe(1);
    expect(calc('=COUNTIF(A1:A4,"a~~b")', stars)).toBe(1);
    expect(calc('=COUNTIF(A1:A4,"a*b")', stars)).toBe(4);
    expect(calc('=COUNTIF(A1:A4,"a?b")', stars)).toBe(4); // ? is any one character, * included
  });

  it('applies the same matching to "<>" and to a criterion held in a cell', () => {
    expect(calc('=COUNTIF(A1:A4,"<>a*")', fruit)).toBe(2); // banana and 7
    expect(calc('=COUNTIF(A1:A4,B1)', { ...fruit, B1: 'a*' })).toBe(2);
    expect(calc('=COUNTIF(A1:A4,B1)', { ...fruit, B1: '>6' })).toBe(1);
  });
});

describe('the SUMIF family shares the criteria semantics', () => {
  const cells = { A1: 3, A2: 'x', A4: 10, B1: 100, B2: 200, B4: 400 };

  it('SUMIF / AVERAGEIF skip blanks in the criteria range', () => {
    expect(calc('=SUMIF(A1:A4,"<5",B1:B4)', cells)).toBe(100);
    expect(calc('=SUMIF(A1:A4,"<>",B1:B4)', cells)).toBe(700);
    expect(calc('=AVERAGEIF(A1:A4,">1",B1:B4)', cells)).toBe(250);
    expect(calc('=SUMIF(A1:A4,"",B1:B4)', cells)).toBe(0);
  });

  it('SUMIFS / COUNTIFS / MAXIFS / MINIFS behave the same', () => {
    expect(calc('=SUMIFS(B1:B4,A1:A4,"<>")', cells)).toBe(700);
    expect(calc('=COUNTIFS(A1:A4,"<5")', cells)).toBe(1);
    expect(calc('=COUNTIFS(A1:A4,"")', cells)).toBe(1);
    expect(calc('=MAXIFS(B1:B4,A1:A4,"<15")', cells)).toBe(400);
    expect(calc('=MINIFS(B1:B4,A1:A4,"<15")', cells)).toBe(100);
  });
});
