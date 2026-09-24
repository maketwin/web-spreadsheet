import { describe, expect, it } from 'vitest';
import { FormulaParser } from '../../src/formula/parser';
import { evaluate } from '../../src/formula/evaluator';
import type { AstNode, CellResolver, FormulaValue } from '../../src/formula/types';

function run(formula: string, cells: Record<string, FormulaValue> = {}, resolveName?: (name: string) => AstNode | null): FormulaValue | readonly FormulaValue[] {
  const ast = new FormulaParser().parse(formula);
  expect(ast).not.toBeNull();
  const resolver: CellResolver = (x, y) => cells[`${x},${y}`] ?? null;
  return evaluate(ast!, resolver, resolveName);
}

describe('IFS', () => {
  it('returns the value of the first truthy condition', () => {
    expect(run('=IFS(A1>90,"优",A1>60,"及格",TRUE,"不及格")', { '0,0': 75 })).toBe('及格');
    expect(run('=IFS(A1>90,"优",A1>60,"及格",TRUE,"不及格")', { '0,0': 30 })).toBe('不及格');
  });

  it('is lazy: errors in not-taken branches do not propagate', () => {
    expect(run('=IFS(A1>10,1/B1,A1>5,"small")', { '0,0': 6 })).toBe('small');
  });

  it('yields #N/A when no condition matches and propagates condition errors', () => {
    expect(run('=IFS(A1>10,"a")', { '0,0': 1 })).toBe('#N/A');
    expect(run('=IFS(1/0,"a",TRUE,"b")')).toBe('#DIV/0!');
  });

  it('rejects an odd argument count', () => {
    expect(run('=IFS(TRUE)')).toBe('#VALUE!');
  });
});

describe('SWITCH', () => {
  it('matches candidates in order and returns the paired result', () => {
    expect(run('=SWITCH(A1,"a",1,"b",2)', { '0,0': 'b' })).toBe(2);
    expect(run('=SWITCH(A1,"a",1,"b",2)', { '0,0': 'b' })).toBe(2);
  });

  it('supports a trailing default and #N/A without one', () => {
    expect(run('=SWITCH(A1,"a",1,"其他")', { '0,0': 'zz' })).toBe('其他');
    expect(run('=SWITCH(A1,"a",1)', { '0,0': 'zz' })).toBe('#N/A');
  });

  it('does not treat error candidates as matches', () => {
    expect(run('=SWITCH(A1,1/0,"e","ok")', { '0,0': 'x' })).toBe('ok');
  });
});

describe('INDIRECT', () => {
  it('resolves a plain A1 text reference', () => {
    expect(run('=INDIRECT("B2")', { '1,1': 42 })).toBe(42);
    expect(run('=INDIRECT("$B$2")', { '1,1': 42 })).toBe(42);
  });

  it('resolves ranges (flattened row-major) and sheet-qualified refs', () => {
    expect(run('=SUM(INDIRECT("A1:A3"))', { '0,0': 1, '0,1': 2, '0,2': 3 })).toBe(6);
    const resolver: CellResolver = (x, y, sheetName) => (sheetName === 'S2' && x === 0 && y === 0 ? 7 : null);
    const ast = new FormulaParser().parse('=INDIRECT("S2!A1")');
    expect(evaluate(ast!, resolver)).toBe(7);
  });

  it('falls back to named ranges and yields #REF! for garbage / R1C1', () => {
    const resolveName = (name: string): AstNode | null => (name === '总量' ? { type: 'cell', x: 0, y: 0 } : null);
    expect(run('=INDIRECT("总量")', { '0,0': 5 }, resolveName)).toBe(5);
    expect(run('=INDIRECT("not a ref!")')).toBe('#REF!');
    expect(run('=INDIRECT("R2C2",FALSE)')).toBe('#REF!');
  });
});

describe('OFFSET', () => {
  it('shifts a base cell and reads the target', () => {
    expect(run('=OFFSET(A1,1,1)', { '1,1': 9 })).toBe(9);
    expect(run('=OFFSET(B2,-1,-1)', { '0,0': 3 })).toBe(3);
  });

  it('resizes with height/width and flattens row-major', () => {
    expect(run('=SUM(OFFSET(A1,0,0,2,2))', { '0,0': 1, '1,0': 2, '0,1': 3, '1,1': 4 })).toBe(10);
    expect(run('=SUM(OFFSET(A1:A2,0,1))', { '1,0': 5, '1,1': 6 })).toBe(11);
  });

  it('yields #REF! for negative targets and non-integer sizes', () => {
    expect(run('=OFFSET(A1,-1,0)')).toBe('#REF!');
    expect(run('=OFFSET(A1,0,0,1.5,1)')).toBe('#REF!');
  });
});
