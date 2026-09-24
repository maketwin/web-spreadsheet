import { describe, expect, it } from 'vitest';
import { FormulaParser } from '../../src/formula/parser';
import { evaluate } from '../../src/formula/evaluator';
import type { CellResolver, FormulaValue } from '../../src/formula/types';

function run(formula: string, cells: Record<string, FormulaValue> = {}): FormulaValue | readonly FormulaValue[] {
  const ast = new FormulaParser().parse(formula);
  expect(ast).not.toBeNull();
  const resolver: CellResolver = (x, y) => cells[`${x},${y}`] ?? null;
  return evaluate(ast!, resolver);
}

describe('UNIQUE', () => {
  it('dedupes case-insensitively and preserves first-seen order', () => {
    expect(run('=UNIQUE(A1:A5)', { '0,0': 'a', '0,1': 'A', '0,2': 'b', '0,3': 1, '0,4': 'a' })).toEqual(['a', 'b', 1]);
  });
});

describe('SORT', () => {
  it('sorts numbers before text, ascending by default', () => {
    expect(run('=SORT(A1:A4)', { '0,0': 3, '0,1': 'b', '0,2': 1, '0,3': 'A' })).toEqual([1, 3, 'A', 'b']);
  });

  it('supports descending order and rejects unknown order', () => {
    expect(run('=SORT(A1:A3,-1)', { '0,0': 1, '0,1': 3, '0,2': 2 })).toEqual([3, 2, 1]);
    expect(run('=SORT(A1:A3,5)', { '0,0': 1 })).toBe('#VALUE!');
  });
});

describe('FILTER', () => {
  it('picks values whose mask entry is truthy', () => {
    expect(run('=FILTER(A1:A4,A1:A4>100)', { '0,0': 50, '0,1': 150, '0,2': 200, '0,3': 80 })).toEqual([150, 200]);
  });

  it('returns if_empty when nothing matches, #CALC! otherwise', () => {
    expect(run('=FILTER(A1:A2,A1:A2>9,"空")', { '0,0': 1, '0,1': 2 })).toBe('空');
    expect(run('=FILTER(A1:A2,A1:A2>9)')).toBe('#CALC!');
  });
});

describe('SEQUENCE', () => {
  it('generates a row-major sequence with start/step', () => {
    expect(run('=SEQUENCE(2,3,10,5)')).toEqual([10, 15, 20, 25, 30, 35]);
    expect(run('=SEQUENCE(3)')).toEqual([1, 2, 3]);
  });

  it('rejects non-positive or fractional dimensions', () => {
    expect(run('=SEQUENCE(0)')).toBe('#VALUE!');
    expect(run('=SEQUENCE(1.5)')).toBe('#VALUE!');
  });
});

describe('dynamic arrays nest inside aggregates', () => {
  it('SUM over UNIQUE and SORT results', () => {
    const cells = { '0,0': 10, '0,1': 10, '0,2': 20, '1,0': 10, '1,1': 20, '1,2': 30 };
    expect(run('=SUM(UNIQUE(A1:A3))', cells)).toBe(30);
    expect(run('=SUM(SORT(B1:B3,-1))', cells)).toBe(60);
  });

  it('FILTER feeds AVERAGE', () => {
    expect(run('=AVERAGE(FILTER(A1:A4,A1:A4>0))', { '0,0': 2, '0,1': 4, '0,2': -1, '0,3': 6 })).toBe(4);
  });
});
