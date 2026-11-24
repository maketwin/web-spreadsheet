import { describe, expect, it } from 'vitest';
import { FormulaParser } from '../../src/formula/parser';
import { evaluate } from '../../src/formula/evaluator';
import { FormulaEngine } from '../../src/formula/FormulaEngine';
import { createFormulaSync } from '../../src/components/Spreadsheet';
import { isMatrix, type AstNode, type CellResolver, type FormulaArgument, type FormulaValue, type MatrixValue } from '../../src/formula/types';
import { Store } from '../../src/store/Store';

const parser = new FormulaParser();

/** Evaluate `=expr` against cells keyed "x,y" (column A is x = 0). */
function run(expr: string, cells: Record<string, FormulaValue> = {}, resolveName?: (name: string) => AstNode | null): FormulaArgument {
  const ast = parser.parse(expr);
  expect(ast, expr).not.toBeNull();
  const resolver: CellResolver = (x, y) => cells[`${x},${y}`] ?? null;
  return evaluate(ast!, resolver, resolveName);
}

/** The result as `{ rows, cols, data }`; the test fails when the formula did not return a matrix. */
function grid(expr: string, cells: Record<string, FormulaValue> = {}, resolveName?: (name: string) => AstNode | null): { rows: number; cols: number; data: unknown[] } {
  const result = run(expr, cells, resolveName);
  expect(isMatrix(result), `${expr} should return a matrix`).toBe(true);
  const m = result as MatrixValue;
  return { rows: m.rows, cols: m.cols, data: [...m.data] };
}

/** Cells for `run` / `grid` from a row-major table whose top-left corner is A1. */
function at(rows: readonly (readonly FormulaValue[])[]): Record<string, FormulaValue> {
  const cells: Record<string, FormulaValue> = {};
  rows.forEach((row, y) => row.forEach((v, x) => { cells[`${x},${y}`] = v; }));
  return cells;
}

/** First value of a formula result (what a cell shows when the result is a list). */
const firstValue = (expr: string, cells: Record<string, FormulaValue> = {}): FormulaValue => {
  const result = run(expr, cells);
  if (isMatrix(result)) return result.data[0] ?? null;
  return (Array.isArray(result) ? result[0] ?? null : result) as FormulaValue;
};

describe('array arithmetic keeps the array shape', () => {
  it('=SEQUENCE(3)*2 is a 3-row matrix 2;4;6 (it used to collapse to its first element)', () => {
    expect(grid('=SEQUENCE(3)*2')).toEqual({ rows: 3, cols: 1, data: [2, 4, 6] });
    expect(grid('=2*SEQUENCE(3)')).toEqual({ rows: 3, cols: 1, data: [2, 4, 6] });
    expect(grid('=SEQUENCE(3)+SEQUENCE(3)')).toEqual({ rows: 3, cols: 1, data: [2, 4, 6] });
    expect(grid('=SEQUENCE(3)/2')).toEqual({ rows: 3, cols: 1, data: [0.5, 1, 1.5] });
    expect(grid('=SEQUENCE(2,3)+1')).toEqual({ rows: 2, cols: 3, data: [2, 3, 4, 5, 6, 7] });
  });

  it('unary minus, comparisons and text concatenation map element-wise too', () => {
    expect(grid('=-SEQUENCE(3)')).toEqual({ rows: 3, cols: 1, data: [-1, -2, -3] });
    expect(grid('=--SEQUENCE(3)')).toEqual({ rows: 3, cols: 1, data: [1, 2, 3] });
    expect(grid('=SEQUENCE(3)>2')).toEqual({ rows: 3, cols: 1, data: [false, false, true] });
    expect(grid('=SEQUENCE(3)=2')).toEqual({ rows: 3, cols: 1, data: [false, true, false] });
    expect(grid('=SEQUENCE(3)&"a"')).toEqual({ rows: 3, cols: 1, data: ['1a', '2a', '3a'] });
    expect(grid('="x"&SEQUENCE(3)')).toEqual({ rows: 3, cols: 1, data: ['x1', 'x2', 'x3'] });
    expect(grid('=SEQUENCE(3)^2')).toEqual({ rows: 3, cols: 1, data: [1, 4, 9] });
  });

  it('a range operand keeps its own row/column extent', () => {
    expect(grid('=A1:A3*2', at([[1], [2], [3]]))).toEqual({ rows: 3, cols: 1, data: [2, 4, 6] });
    expect(grid('=A1:C1*2', at([[1, 2, 3]]))).toEqual({ rows: 1, cols: 3, data: [2, 4, 6] });
    const block = at([[1, 2], [3, 4]]); // A1:B2
    expect(grid('=A1:B2+1', block)).toEqual({ rows: 2, cols: 2, data: [2, 3, 4, 5] });
    expect(grid('=A1:B2*10', block)).toEqual({ rows: 2, cols: 2, data: [10, 20, 30, 40] });
    expect(grid('=A1:B2>2', block)).toEqual({ rows: 2, cols: 2, data: [false, false, true, true] });
  });

  it('a named range is a range as far as the shape goes', () => {
    const qty: AstNode = { type: 'range', x1: 0, y1: 0, x2: 0, y2: 2 };
    expect(grid('=Qty*10', { '0,0': 1, '0,1': 2, '0,2': 3 }, (name) => (name === 'Qty' ? qty : null)))
      .toEqual({ rows: 3, cols: 1, data: [10, 20, 30] });
  });

  it('a scalar, a one-row or a one-column array broadcasts against the other operand (Excel)', () => {
    expect(grid('=SEQUENCE(3)*SEQUENCE(1,3)')).toEqual({ rows: 3, cols: 3, data: [1, 2, 3, 2, 4, 6, 3, 6, 9] });
    // SEQUENCE(3,2) = [1 2 / 3 4 / 5 6]; the column [1;2;3] is added to each row, the row [1 2] multiplies down the columns.
    expect(grid('=SEQUENCE(3,2)+SEQUENCE(3)')).toEqual({ rows: 3, cols: 2, data: [2, 3, 5, 6, 8, 9] });
    expect(grid('=SEQUENCE(3,2)*SEQUENCE(1,2)')).toEqual({ rows: 3, cols: 2, data: [1, 4, 3, 8, 5, 12] });
    expect(grid('=SEQUENCE(3)+A1', { '0,0': 10 })).toEqual({ rows: 3, cols: 1, data: [11, 12, 13] });
  });

  it('arrays that cannot be lined up are #N/A, like Excel', () => {
    expect(run('=SEQUENCE(2)*SEQUENCE(3)')).toBe('#N/A');
    expect(run('=SEQUENCE(2,3)+SEQUENCE(3,2)')).toBe('#N/A');
    expect(run('=A1:A3+A1:A2', { '0,0': 1, '0,1': 2, '0,2': 3 })).toBe('#N/A');
  });

  it('a 1×1 result is an ordinary scalar', () => {
    expect(run('=A1:A1+1', { '0,0': 1 })).toBe(2);
    expect(run('=SEQUENCE(1)*2')).toBe(2);
    expect(run('=-A1:A1', { '0,0': 1 })).toBe(-1);
  });

  it('errors propagate element by element', () => {
    expect(grid('=A1:A3*2', { '0,0': 1, '0,1': '#DIV/0!', '0,2': 3 })).toEqual({ rows: 3, cols: 1, data: [2, '#DIV/0!', 6] });
    expect(grid('=SEQUENCE(3)+A1', { '0,0': '#REF!' })).toEqual({ rows: 3, cols: 1, data: ['#REF!', '#REF!', '#REF!'] });
    expect(grid('=-A1:A2', { '0,0': '#SPILL!', '0,1': 1 })).toEqual({ rows: 2, cols: 1, data: ['#SPILL!', -1] });
    expect(grid('=A1:A2&"x"', { '0,0': '#API!', '0,1': 'a' })).toEqual({ rows: 2, cols: 1, data: ['#API!', 'ax'] });
  });

  it('still nests inside aggregates and lookups', () => {
    const cells = { '0,0': 1, '0,1': 2, '0,2': 3, '1,0': 'a', '1,1': 'b', '1,2': 'a' };
    expect(firstValue('=SUM(A1:A3*2)', cells)).toBe(12);
    expect(firstValue('=SUM(SEQUENCE(3)+SEQUENCE(3))')).toBe(12);
    expect(firstValue('=SUMPRODUCT((B1:B3="a")*(A1:A3))', cells)).toBe(4);
    expect(firstValue('=SUMPRODUCT((B1:B3="a")*A1:A3)', cells)).toBe(4);
    expect(firstValue('=MATCH(TRUE,A1:A3>2,0)', cells)).toBe(3);
    expect(firstValue('=COUNTIF(A1:A3*2,">4")', cells)).toBe(1);
    expect(firstValue('=AVERAGE(SEQUENCE(3)*2)')).toBe(4);
  });
});

describe('array arithmetic through the engine (spill)', () => {
  function setup(seed: (store: Store) => void): { store: Store; unsubscribe: () => void } {
    const store = new Store();
    const sync = createFormulaSync(store, new FormulaEngine(store)); // registers and recalculates like the UI
    seed(store);
    return { store, unsubscribe: sync.unsubscribe };
  }

  it('=SEQUENCE(3)*2 spills 2;4;6 over three cells', () => {
    const { store, unsubscribe } = setup((s) => { s.setCell(0, 0, { formula: '=SEQUENCE(3)*2', text: '' }); });
    try {
      const anchor = `${store.getActiveSheetId()}:0,0`;
      expect([0, 1, 2].map((r) => store.getCell(r, 0)?.value)).toEqual([2, 4, 6]);
      expect([1, 2].map((r) => store.getCell(r, 0)?.spillOf)).toEqual([anchor, anchor]);
      expect(store.getCell(3, 0)).toBeUndefined();
    } finally { unsubscribe(); }
  });

  it('a range calculation spills with the range shape, a row range sideways', () => {
    const { store, unsubscribe } = setup((s) => {
      s.setCell(0, 1, { text: '1' }); s.setCell(1, 1, { text: '2' }); s.setCell(2, 1, { text: '3' }); // B1:B3
      s.setCell(0, 0, { formula: '=B1:B3*10', text: '' }); // A1:A3
      s.setCell(5, 0, { text: '1' }); s.setCell(5, 1, { text: '2' }); s.setCell(5, 2, { text: '3' }); // A6:C6
      s.setCell(6, 0, { formula: '=A6:C6*10', text: '' }); // A7:C7
    });
    try {
      expect([0, 1, 2].map((r) => store.getCell(r, 0)?.value)).toEqual([10, 20, 30]);
      expect([0, 1, 2].map((c) => store.getCell(6, c)?.value)).toEqual([10, 20, 30]);
    } finally { unsubscribe(); }
  });

  it('a blocker collapses the spill to #SPILL!, and a shape mismatch is #N/A in the anchor', () => {
    const { store, unsubscribe } = setup((s) => {
      s.setCell(1, 0, { text: 'blocker' });
      s.setCell(0, 0, { formula: '=SEQUENCE(3)*2', text: '' });
      s.setCell(4, 0, { formula: '=SEQUENCE(2)*SEQUENCE(3)', text: '' });
    });
    try {
      expect(store.getCell(0, 0)?.value).toBe('#SPILL!');
      expect(store.getCell(4, 0)?.value).toBe('#N/A');
      // The blocker is the only thing in the way: clearing it lets the values through.
      store.setCell(1, 0, undefined);
      expect([0, 1, 2].map((r) => store.getCell(r, 0)?.value)).toEqual([2, 4, 6]);
    } finally { unsubscribe(); }
  });
});

describe('FILTER keeps the source columns', () => {
  // A1:C3 rows: [a 1 1] [b 2 0] [c 3 1]
  const table = at([['a', 1, 1], ['b', 2, 0], ['c', 3, 1]]);

  it('=FILTER(A1:B3, C1:C3=1) is a 2×2 matrix', () => {
    expect(grid('=FILTER(A1:B3,C1:C3=1)', table)).toEqual({ rows: 2, cols: 2, data: ['a', 1, 'c', 3] });
    expect(grid('=FILTER(A1:B3,C1:C3=0)', table)).toEqual({ rows: 1, cols: 2, data: ['b', 2] });
    expect(firstValue('=SUM(FILTER(B1:B3,C1:C3=1))', table)).toBe(4);
  });

  it('a one-row mask picks columns', () => {
    // A1:C2 = [10 20 30 / x y z]; A3:C3 = 1, 0, 1
    const cells = at([[10, 20, 30], ['x', 'y', 'z'], [1, 0, 1]]);
    expect(grid('=FILTER(A1:C2,A3:C3=1)', cells)).toEqual({ rows: 2, cols: 2, data: [10, 30, 'x', 'z'] });
  });

  it('a mask of the wrong size is #VALUE!; nothing matched is #CALC! or if_empty', () => {
    expect(run('=FILTER(A1:B3,C1:C4=1)', table)).toBe('#VALUE!');
    expect(run('=FILTER(A1:B3,C1:C3=9)', table)).toBe('#CALC!');
    expect(run('=FILTER(A1:B3,C1:C3=9,"none")', table)).toBe('none');
    // The one-column case keeps working as before.
    expect(grid('=FILTER(A1:A4,A1:A4>100)', { '0,0': 50, '0,1': 150, '0,2': 200, '0,3': 80 })).toEqual({ rows: 2, cols: 1, data: [150, 200] });
  });
});

describe('SORT keeps the shape and honours sort_index', () => {
  // A1:B3 rows: [b 2] [a 3] [c 1]
  const table = at([['b', 2], ['a', 3], ['c', 1]]);

  it('sorts a one-column range ascending, descending in the old and the Excel form', () => {
    expect(grid('=SORT(A1:A4)', at([[3], ['b'], [1], ['A']]))).toEqual({ rows: 4, cols: 1, data: [1, 3, 'A', 'b'] });
    expect(grid('=SORT(A1:A3,-1)', { '0,0': 1, '0,1': 3, '0,2': 2 })).toEqual({ rows: 3, cols: 1, data: [3, 2, 1] });
    expect(grid('=SORT(A1:A3,1,-1)', { '0,0': 1, '0,1': 3, '0,2': 2 })).toEqual({ rows: 3, cols: 1, data: [3, 2, 1] });
    expect(run('=SORT(A1:A3,5)', { '0,0': 1 })).toBe('#VALUE!');
    expect(run('=SORT(A1:A3,1,0)', { '0,0': 1 })).toBe('#VALUE!');
  });

  it('sorts rows by the sort_index-th column and keeps every column', () => {
    expect(grid('=SORT(A1:B3,2)', table)).toEqual({ rows: 3, cols: 2, data: ['c', 1, 'b', 2, 'a', 3] });
    expect(grid('=SORT(A1:B3,2,-1)', table)).toEqual({ rows: 3, cols: 2, data: ['a', 3, 'b', 2, 'c', 1] });
    expect(grid('=SORT(A1:B3)', table)).toEqual({ rows: 3, cols: 2, data: ['a', 3, 'b', 2, 'c', 1] }); // by column 1
    expect(run('=SORT(A1:B3,3)', table)).toBe('#VALUE!'); // there is no third column to sort by
  });

  it('by_col reorders columns by a key row', () => {
    // A1:C2 = [3 1 2 / c a b]
    const cells = at([[3, 1, 2], ['c', 'a', 'b']]);
    expect(grid('=SORT(A1:C2,1,1,TRUE)', cells)).toEqual({ rows: 2, cols: 3, data: [1, 2, 3, 'a', 'b', 'c'] });
    expect(grid('=SORT(A1:C2,1,-1,TRUE)', cells)).toEqual({ rows: 2, cols: 3, data: [3, 2, 1, 'c', 'b', 'a'] });
    // Row sorting a single row leaves it as it is (one row has nothing to reorder).
    expect(grid('=SORT(A1:C2)', cells)).toEqual({ rows: 2, cols: 3, data: [3, 1, 2, 'c', 'a', 'b'] });
  });

  it('equal keys keep their original order in both directions', () => {
    const cells = at([[2, 'x'], [1, 'y'], [2, 'z']]);
    expect(grid('=SORT(A1:B3,1)', cells)).toEqual({ rows: 3, cols: 2, data: [1, 'y', 2, 'x', 2, 'z'] });
    expect(grid('=SORT(A1:B3,1,-1)', cells)).toEqual({ rows: 3, cols: 2, data: [2, 'x', 2, 'z', 1, 'y'] });
  });
});

describe('UNIQUE', () => {
  it('dedupes a column case-insensitively and preserves first-seen order', () => {
    expect(grid('=UNIQUE(A1:A5)', { '0,0': 'a', '0,1': 'A', '0,2': 'b', '0,3': 1, '0,4': 'a' })).toEqual({ rows: 3, cols: 1, data: ['a', 'b', 1] });
  });

  it('returns a row for a single-row input', () => {
    // A1:D1 = a, A, b, a → 'a' (first spelling), 'b'
    expect(grid('=UNIQUE(A1:D1)', at([['a', 'A', 'b', 'a']]))).toEqual({ rows: 1, cols: 2, data: ['a', 'b'] });
  });

  it('dedupes whole rows of a table and keeps the columns', () => {
    const table = at([['a', 1], ['a', 1], ['b', 2], ['a', 2]]);
    expect(grid('=UNIQUE(A1:B4)', table)).toEqual({ rows: 3, cols: 2, data: ['a', 1, 'b', 2, 'a', 2] });
    expect(grid('=UNIQUE(SEQUENCE(2,3))')).toEqual({ rows: 2, cols: 3, data: [1, 2, 3, 4, 5, 6] });
  });
});
