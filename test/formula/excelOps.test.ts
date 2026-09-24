import { describe, expect, it } from 'vitest';
import { FormulaParser } from '../../src/formula/parser';
import { evaluate } from '../../src/formula/evaluator';
import type { CellResolver, FormulaValue } from '../../src/formula/types';

/** Evaluate a formula string against a small cell map keyed "x,y". */
function run(formula: string, cells: Record<string, FormulaValue> = {}): FormulaValue | readonly FormulaValue[] {
  const ast = new FormulaParser().parse(formula);
  expect(ast).not.toBeNull();
  const resolver: CellResolver = (x, y) => cells[`${x},${y}`] ?? null;
  return evaluate(ast!, resolver);
}

describe('absolute references ($A$1)', () => {
  it('parses and evaluates fully anchored refs', () => {
    expect(run('=$A$1+1', { '0,0': 41 })).toBe(42);
  });

  it('parses mixed anchors and ranges', () => {
    expect(run('=SUM($A$1:A$2)', { '0,0': 1, '0,1': 2 })).toBe(3);
  });

  it('still parses plain refs', () => {
    expect(run('=B2*2', { '1,1': 5 })).toBe(10);
  });
});

describe('INDEX and MATCH', () => {
  it('INDEX uses both row and column', () => {
    expect(run('=INDEX(A1:C3,2,3)', { '2,1': 9 })).toBe(9);
  });

  it('MATCH exact miss is #N/A and default type is approximate', () => {
    const col = { '0,0': 1, '0,1': 10, '0,2': 20 };
    expect(run('=MATCH(5,A1:A3,0)', col)).toBe('#N/A');
    expect(run('=MATCH(5,A1:A3)', col)).toBe(1);
  });
});

describe('comparison and concat operators (Excel parity)', () => {
  it('supports >= and <=', () => {
    expect(run('=A1>=2', { '0,0': 2 })).toBe(true);
    expect(run('=A1<=1', { '0,0': 2 })).toBe(false);
  });

  it('supports = with case-insensitive text equality', () => {
    expect(run('=A1=B1', { '0,0': 'Apple', '1,0': 'apple' })).toBe(true);
    expect(run('=A1=5', { '0,0': 'x' })).toBe(false);
  });

  it('supports <>', () => {
    expect(run('=A1<>B1', { '0,0': 'a', '1,0': 'b' })).toBe(true);
    expect(run('=1<>1')).toBe(false);
  });

  it('supports & concatenation', () => {
    expect(run('=A1&B1', { '0,0': 'foo', '1,0': 'bar' })).toBe('foobar');
    expect(run('=A1&1', { '0,0': 'n' })).toBe('n1');
  });

  it('feeds comparisons into IF', () => {
    expect(run('=IF(A1>=60,B1,B2)', { '0,0': 70, '1,0': 'pass', '1,1': 'fail' })).toBe('pass');
    expect(run('=IF(A1>=60,B1,B2)', { '0,0': 40, '1,0': 'pass', '1,1': 'fail' })).toBe('fail');
  });
});

describe('grouping and literals (parser hardening)', () => {
  it('evaluates parenthesized groups', () => {
    expect(run('=(1+2)*3')).toBe(9);
    expect(run('=(A1+1)*2', { '0,0': 4 })).toBe(10);
  });

  it('mixes groups with function calls', () => {
    expect(run('=SUM(A1:A2)*(1+1)', { '0,0': 1, '0,1': 2 })).toBe(6);
    expect(run('=(A1)*(B1)', { '0,0': 3, '1,0': 4 })).toBe(12);
  });

  it('keeps scientific notation intact', () => {
    expect(run('=1E-3')).toBe(0.001);
    expect(run('=1E+3+1')).toBe(1001);
  });

  it('chains & left to right', () => {
    expect(run('=A1&B1&C1', { '0,0': 'a', '1,0': 'b', '2,0': 'c' })).toBe('abc');
  });
});

describe('operator precedence and string literals (Excel parity)', () => {
  it('* and / bind tighter than + and -', () => {
    expect(run('=1+2*3')).toBe(7);
    expect(run('=10-6/2')).toBe(7);
    expect(run('=2*3+4*5')).toBe(26);
  });

  it('& binds looser than arithmetic but tighter than comparisons', () => {
    expect(run('=A1&1+1', { '0,0': 'v' })).toBe('v2');
    expect(run('=A1&B1="ab"', { '0,0': 'a', '1,0': 'b' })).toBe(true);
  });

  it('honors parens over precedence', () => {
    expect(run('=(1+2)*3')).toBe(9);
  });

  it('evaluates quoted string literals', () => {
    expect(run('="yes"')).toBe('yes');
    expect(run('=IF(A1>=60,"pass","fail")', { '0,0': 40 })).toBe('fail');
    expect(run('="a"&"b"')).toBe('ab');
  });

  it('handles escaped quotes and operators inside literals', () => {
    expect(run('="a""b"')).toBe('a"b');
    expect(run('=IF(A1=1,"x,y","z")', { '0,0': 1 })).toBe('x,y');
    expect(run('="1+1"')).toBe('1+1');
  });
});

describe('VLOOKUP', () => {
  const table = { '0,0': 'apple', '1,0': 10, '0,1': 'banana', '1,1': 20, '0,2': 'cherry', '1,2': 30 };

  it('exact match (FALSE) finds the row, case-insensitive', () => {
    expect(run('=VLOOKUP(A4,A1:B3,2,0)', { ...table, '0,3': 'BANANA' })).toBe(20);
  });

  it('exact match returns #N/A when missing', () => {
    expect(run('=VLOOKUP(A4,A1:B3,2,0)', { ...table, '0,3': 'durian' })).toBe('#N/A');
  });

  it('approximate match (default) returns largest key <= lookup', () => {
    const nums = { '0,0': 1, '1,0': 'a', '0,1': 5, '1,1': 'b', '0,2': 9, '1,2': 'c' };
    expect(run('=VLOOKUP(A4,A1:B3,2)', { ...nums, '0,3': 6 })).toBe('b');
  });

  it('approximate match below the first key returns #N/A', () => {
    const nums = { '0,0': 1, '1,0': 'a', '0,1': 5, '1,1': 'b' };
    expect(run('=VLOOKUP(A3,A1:B2,2)', { ...nums, '0,2': 0 })).toBe('#N/A');
  });

  it('rejects an out-of-table column index', () => {
    expect(run('=VLOOKUP(A4,A1:B3,5,0)', { ...table, '0,3': 'apple' })).toBeNull();
  });
});
