import { describe, expect, it } from 'vitest';
import { FormulaParser } from '../../src/formula/parser';
import { evaluate, type EvalContext } from '../../src/formula/evaluator';
import type { FormulaValue } from '../../src/formula/types';
import { Store } from '../../src/store/Store';
import { FormulaEngine } from '../../src/formula/FormulaEngine';

const parser = new FormulaParser();

function calc(formula: string, cells: Record<string, FormulaValue> = {}, ctx?: EvalContext): FormulaValue {
  const ast = parser.parse(formula);
  if (ast === null) throw new Error(`parse failed: ${formula}`);
  const resolve = (x: number, y: number): FormulaValue => {
    const key = `${String.fromCharCode(65 + x)}${y + 1}`;
    return cells[key] ?? null;
  };
  const result = evaluate(ast, resolve, undefined, ctx);
  return (Array.isArray(result) ? (result[0] ?? null) : result) as FormulaValue;
}

describe('Phase A — HLOOKUP / XLOOKUP / AVERAGEIF(S) / SUBTOTAL / TEXTJOIN', () => {
  it('HLOOKUP exact and approximate', () => {
    const cells = { A1: 'a', B1: 'b', C1: 'c', A2: 10, B2: 20, C2: 30 };
    expect(calc('=HLOOKUP("b",A1:C2,2,FALSE)', cells)).toBe(20);
    expect(calc('=HLOOKUP("z",A1:C2,2,FALSE)', cells)).toBe('#N/A');
    expect(calc('=HLOOKUP("b",A1:C2,2)', cells)).toBe(20);
  });

  it('XLOOKUP exact, if_not_found, wildcard', () => {
    const cells = { A1: 'apple', A2: 'banana', A3: 'cherry', B1: 1, B2: 2, B3: 3 };
    expect(calc('=XLOOKUP("banana",A1:A3,B1:B3)', cells)).toBe(2);
    expect(calc('=XLOOKUP("nope",A1:A3,B1:B3,"missing")', cells)).toBe('missing');
    expect(calc('=XLOOKUP("ban*",A1:A3,B1:B3,,2)', cells)).toBe(2);
    expect(calc('=XLOOKUP("cherry",A1:A3,B1:B3,,, -1)', cells)).toBe(3);
  });

  it('AVERAGEIF / AVERAGEIFS', () => {
    expect(calc('=AVERAGEIF(A1:A3,">1")', { A1: 1, A2: 2, A3: 3 })).toBe(2.5);
    expect(calc('=AVERAGEIFS(C1:C3,A1:A3,">1",B1:B3,"x")', {
      A1: 1, A2: 2, A3: 3, B1: 'x', B2: 'x', B3: 'y', C1: 10, C2: 20, C3: 30,
    })).toBe(20);
    expect(calc('=AVERAGEIF(A1:A3,">9")', { A1: 1, A2: 2, A3: 3 })).toBe('#DIV/0!');
  });

  it('TEXTJOIN', () => {
    expect(calc('=TEXTJOIN(",",TRUE,A1:A3)', { A1: 'a', A2: '', A3: 'c' })).toBe('a,c');
    expect(calc('=TEXTJOIN("-",FALSE,A1:A3)', { A1: 'a', A2: '', A3: 'c' })).toBe('a--c');
  });

  it('SUBTOTAL skips hidden rows via EvalContext', () => {
    const cells = { A1: 1, A2: 2, A3: 3, A4: 4 };
    const hidden = new Set([1]); // row index 1 = A2
    const ctx: EvalContext = { isRowHidden: (row) => hidden.has(row) };
    expect(calc('=SUBTOTAL(9,A1:A4)', cells, ctx)).toBe(8); // 1+3+4
    expect(calc('=SUBTOTAL(109,A1:A4)', cells, ctx)).toBe(8);
    expect(calc('=SUBTOTAL(1,A1:A4)', cells, ctx)).toBeCloseTo(8 / 3);
    expect(calc('=SUBTOTAL(2,A1:A4)', cells, ctx)).toBe(3);
  });

  it('SUBTOTAL via FormulaEngine respects Store row hide', () => {
    const store = new Store();
    const engine = new FormulaEngine(store);
    store.setCell(0, 0, { text: '1', value: 1 });
    store.setCell(1, 0, { text: '2', value: 2 });
    store.setCell(2, 0, { text: '3', value: 3 });
    store.setRow(1, { hide: true });
    engine.setFormula('3,0', '=SUBTOTAL(9,A1:A3)', ['0,0', '1,0', '2,0']);
    expect(store.getCell(3, 0)?.value).toBe(4); // 1+3
  });
});
