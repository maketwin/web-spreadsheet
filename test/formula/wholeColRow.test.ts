import { describe, expect, it } from 'vitest';
import { Store } from '../../src/store/Store';
import { FormulaEngine } from '../../src/formula/FormulaEngine';
import { createFormulaSync } from '../../src/formula/formulaSync';
import { FormulaParser } from '../../src/formula/parser';
import { shiftFormulaRows, shiftFormulaCols } from '../../src/formula/refRewrite';
import { TOTAL_COLS, TOTAL_ROWS } from '../../src/util/gridSize';

const parser = new FormulaParser();

/** Store + engine + sync, with a `put` helper like the other suites. */
function setup(): { store: Store; put: (r: number, c: number, text: string) => void; value: (r: number, c: number) => unknown } {
  const store = new Store();
  const engine = new FormulaEngine(store);
  createFormulaSync(store, engine);
  const put = (r: number, c: number, text: string): void => {
    store.setCell(r, c, text.startsWith('=') ? { text, formula: text } : { text, value: Number(text) });
  };
  return { store, put, value: (r, c) => store.getCell(r, c)?.value };
}

describe('whole-column / whole-row references', () => {
  it('f. the parser reads A:A, A:C, 3:5 and their $-anchored forms', () => {
    expect(parser.parse('=A:A')).toEqual({ type: 'range', x1: 0, y1: 0, x2: 0, y2: TOTAL_ROWS - 1 });
    expect(parser.parse('=A:C')).toEqual({ type: 'range', x1: 0, y1: 0, x2: 2, y2: TOTAL_ROWS - 1 });
    expect(parser.parse('=3:5')).toEqual({ type: 'range', x1: 0, y1: 2, x2: TOTAL_COLS - 1, y2: 4 });
    expect(parser.parse('=$A:$A')).toEqual({ type: 'range', x1: 0, y1: 0, x2: 0, y2: TOTAL_ROWS - 1 });
    expect(parser.parse('=Sheet2!B:B')).toEqual({ type: 'range', x1: 1, y1: 0, x2: 1, y2: TOTAL_ROWS - 1, sheetName: 'Sheet2' });
    // Open-ended references: a missing dimension opens toward that edge.
    expect(parser.parse('=B2:B')).toEqual({ type: 'range', x1: 1, y1: 1, x2: 1, y2: TOTAL_ROWS - 1 });
    expect(parser.parse('=B1:1')).toEqual({ type: 'range', x1: 1, y1: 0, x2: TOTAL_COLS - 1, y2: 0 });
    expect(parser.parse('=$B$2:$B')).toEqual({ type: 'range', x1: 1, y1: 1, x2: 1, y2: TOTAL_ROWS - 1 });
    expect(parser.parse('=Sheet2!B2:B')).toEqual({ type: 'range', x1: 1, y1: 1, x2: 1, y2: TOTAL_ROWS - 1, sheetName: 'Sheet2' });
  });

  it('f2. SUM over whole columns answers across the address space', () => {
    const { put, value } = setup();
    put(0, 0, '1'); put(1, 0, '2'); put(2, 0, '3');
    put(0, 1, '10'); put(1, 1, '20'); put(2, 1, '30');
    // Formulas in column E, outside A:D, so none reads its own result.
    put(0, 4, '=SUM(A:A)');
    put(1, 4, '=SUM(A:C)');
    put(2, 4, '=SUM(A:B)');
    put(3, 4, '=SUM($A:$A)');
    put(4, 4, '=COUNTBLANK(A1:A5)');
    expect(value(0, 4)).toBe(6);
    expect(value(1, 4)).toBe(66);
    expect(value(2, 4)).toBe(66);
    expect(value(3, 4)).toBe(6);
    expect(value(4, 4)).toBe(2); // A4 and A5 are blank
  });

  it('f3. SUM over whole rows answers across the address space', () => {
    const { put, value } = setup();
    put(0, 0, '1'); put(1, 0, '2'); put(2, 0, '3');
    put(0, 1, '10'); put(1, 1, '20'); put(2, 1, '30');
    put(9, 4, '=SUM(1:3)'); // row 10: outside its own range
    put(10, 4, '=SUM(2:2)');
    put(11, 4, '=SUM(2:3)');
    expect(value(9, 4)).toBe(66);
    expect(value(10, 4)).toBe(22);
    expect(value(11, 4)).toBe(55);
  });

  it('f3b. open-ended B2:B evaluates and works through INDIRECT', () => {
    const { put, value } = setup();
    put(1, 1, '1'); put(2, 1, '2'); // B2, B3
    put(1, 4, '=SUM(B2:B)'); // column F, outside column B
    put(5, 4, '=SUM(INDIRECT("B2:B"))');
    expect(value(1, 4)).toBe(3);
    expect(value(5, 4)).toBe(3);
    // The reference registers as a rectangle: a change far below updates it.
    put(500, 1, '10');
    expect(value(1, 4)).toBe(13);
    expect(value(5, 4)).toBe(13);
  });

  it('f3c. open-ended references: the anchored end shifts, the open end stays open', () => {
    // The scanner rewrites the anchored half like an ordinary cell ref and
    // copies the open half verbatim — Excel adjusts B2:B to B3:B on a row
    // insert above it. Whole-column refs (no anchored end) stay untouched.
    expect(shiftFormulaRows('=SUM(B2:B)', 0, 1)).toBe('=SUM(B3:B)');
    expect(shiftFormulaRows('=SUM(B2:B)', 5, -1)).toBe('=SUM(B2:B)');
    expect(shiftFormulaCols('=SUM(B1:1)', 0, 1)).toBe('=SUM(C1:1)');
    expect(shiftFormulaRows('=SUM($B$2:$B)', 0, 1)).toBe('=SUM($B$3:$B)');
  });

  it('f4. ROWS/COLUMNS/ROW read whole-reference shapes', () => {
    const { put, value } = setup();
    put(0, 3, '=ROWS(A:A)');
    put(1, 3, '=COLUMNS(3:5)');
    put(2, 3, '=ROW(C5:C9)');
    expect(value(0, 3)).toBe(TOTAL_ROWS);
    expect(value(1, 3)).toBe(TOTAL_COLS);
    expect(value(2, 3)).toBe(5);
  });

  it('f5. row inserts leave whole-column refs alone but shift cell refs (refRewrite)', () => {
    expect(shiftFormulaRows('=SUM(A:A)', 0, 1)).toBe('=SUM(A:A)');
    expect(shiftFormulaRows('=SUM($A:$A)', 0, 1)).toBe('=SUM($A:$A)');
    expect(shiftFormulaRows('=SUM(A1:A5)', 0, 1)).toBe('=SUM(A2:A6)');
    expect(shiftFormulaRows('=SUM(A1:A5)', 2, -1)).toBe('=SUM(A1:A4)');
    // Whole-row refs stay put under column edits, and vice versa. A cell
    // range shifts whole (insert at A pushes A1:C1 right to B1:D1) — the
    // contract pinned by test/commands/insertDeleteRefs.test.ts.
    expect(shiftFormulaCols('=SUM(1:3)', 0, 1)).toBe('=SUM(1:3)');
    expect(shiftFormulaCols('=SUM(A1:C1)', 0, 1)).toBe('=SUM(B1:D1)');
  });
});
