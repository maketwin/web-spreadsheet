import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { Store } from '../../src/store/Store';
import { FormulaEngine } from '../../src/formula/FormulaEngine';
import { createFormulaSync } from '../../src/formula/formulaSync';

/**
 * Ranges beyond MAX_DENSE_RANGE_CELLS evaluate as sparse values: aggregates
 * walk the stored cells (never the address space), indexed uses answer
 * '#VALUE!', and errors inside the range propagate as before.
 */
describe('sparse range evaluation', () => {
  let store: Store;
  let engine: FormulaEngine;

  beforeEach(() => {
    store = new Store();
    engine = new FormulaEngine(store);
    createFormulaSync(store, engine);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const putValue = (r: number, c: number, value: number): void => {
    store.setCell(r, c, { text: String(value), value });
  };
  const putFormula = (r: number, c: number, text: string): void => {
    store.setCell(r, c, { text, formula: text });
  };
  const value = (r: number, c: number): unknown => store.getCell(r, c)?.value;

  it('a. SUM over 1,000,000 stored cells reads no empty address', () => {
    for (let r = 0; r < 1_000_000; r += 1) putValue(r, 0, r + 1);
    // Count the stored-cell walk and the raw address reads of the evaluation.
    let walked = 0;
    const origWalk = store.forEachCellInRect.bind(store);
    vi.spyOn(store, 'forEachCellInRect').mockImplementation((rect, fn, sheetId) => {
      origWalk(rect, (r, c, cell) => { walked += 1; fn(r, c, cell); }, sheetId);
    });
    const getCellSpy = vi.spyOn(store, 'getCell');
    putFormula(0, 2, '=SUM(A1:A1000000)');
    expect(value(0, 2)).toBe(500_000_500_000);
    expect(walked).toBe(1_000_000); // every stored cell, once
    // resolve() touched stored addresses (+ a constant for the result write)
    // — never more than what exists.
    expect(getCellSpy.mock.calls.length).toBeLessThanOrEqual(1_000_000 + 100);
  }, 120_000);

  it('a2. an area-above-ceiling range over sparse data resolves a bounded number of addresses', () => {
    // 10 stored cells inside a 2,000,001-cell range: evaluation must not
    // wander anywhere near the area.
    for (let r = 0; r < 10; r += 1) putValue(r, 0, r + 1);
    const getCellSpy = vi.spyOn(store, 'getCell');
    putFormula(0, 2, '=SUM(A1:A2000001)');
    expect(value(0, 2)).toBe(55);
    expect(getCellSpy.mock.calls.length).toBeLessThan(10 + 100);
  }, 60_000);

  it('b. small ranges still evaluate densely (INDEX / VLOOKUP / array math)', () => {
    putValue(0, 0, 1); putValue(1, 0, 2); putValue(2, 0, 3);
    putValue(0, 1, 10); putValue(1, 1, 20); putValue(2, 1, 30);
    putFormula(0, 3, '=INDEX(A1:B3, 2, 2)');
    putFormula(1, 3, '=VLOOKUP(2, A1:B3, 2, FALSE)');
    putFormula(2, 3, '=SUM(A1:A3*2)');
    expect(value(0, 3)).toBe(20);
    expect(value(1, 3)).toBe(20);
    expect(value(2, 3)).toBe(12);
  });

  it('c. aggregates answer exactly above the ceiling; MATCH refuses', () => {
    for (let r = 0; r < 10; r += 1) putValue(r, 0, r + 1);
    putFormula(0, 3, '=SUM(A1:A2000001)');
    putFormula(1, 3, '=AVERAGE(A1:A2000001)');
    putFormula(2, 3, '=MEDIAN(A1:A2000001)');
    putFormula(3, 3, '=COUNT(A1:A2000001)');
    putFormula(4, 3, '=COUNTA(A1:A2000001)');
    putFormula(5, 3, '=COUNTBLANK(A1:A2000001)');
    putFormula(6, 3, '=INDEX(A1:A2000001, 5)');
    putFormula(7, 3, '=INDEX(A1:C2000001, 5, 2)');
    putFormula(8, 3, '=MAX(A1:A2000001)');
    putFormula(9, 3, '=MIN(A1:A2000001)');
    expect(value(0, 3)).toBe(55);
    expect(value(1, 3)).toBe(5.5);
    expect(value(2, 3)).toBe(5.5);
    expect(value(3, 3)).toBe(10);
    expect(value(4, 3)).toBe(10);
    expect(value(5, 3)).toBe(2_000_001 - 10); // area minus the stored values
    expect(value(6, 3)).toBe(5); // scalar INDEX reads the address, no materialisation
    expect(value(7, 3)).toBeNull(); // column C of the 5th row: nothing stored there
    expect(value(8, 3)).toBe(10);
    expect(value(9, 3)).toBe(1);
    putFormula(10, 3, '=MATCH(3, A1:A2000001, 0)');
    expect(value(10, 3)).toBe('#VALUE!'); // MATCH needs positions — refuses (Excel would too, beyond any materialisable range)
  }, 60_000);

  it('c2. criteria aggregates work over a huge range', () => {
    for (let r = 0; r < 10; r += 1) putValue(r, 0, r + 1);
    for (let r = 0; r < 10; r += 1) putValue(r, 1, (r + 1) * 10); // B: 10..100
    putFormula(0, 3, '=COUNTIF(A1:A2000001, ">2")');
    putFormula(1, 3, '=SUMIF(A1:A2000001, ">2", B1:B2000001)');
    putFormula(2, 3, '=SUMIFS(B1:B2000001, A1:A2000001, ">2", A1:A2000001, "<5")');
    putFormula(3, 3, '=AVERAGEIF(A1:A2000001, ">8")');
    putFormula(4, 3, '=MAXIFS(B1:B2000001, A1:A2000001, "<4")');
    putFormula(5, 3, '=AND(A1:A2000001)');
    putFormula(6, 3, '=OR(A1:A2000001)');
    putFormula(7, 3, '=SUMPRODUCT(A1:A2000001, B1:B2000001)');
    putFormula(8, 4, '=VLOOKUP(3, A1:B2000001, 2, FALSE)');
    putFormula(9, 4, '=VLOOKUP(2.5, A1:B2000001, 2)');
    putFormula(10, 4, '=COUNTIF(A1:A2000001, "")');
    putFormula(11, 4, '=SUMIF(A1:A2000001, "", B1:B2000001)');
    expect(value(0, 3)).toBe(8);
    expect(value(1, 3)).toBe(30 + 40 + 50 + 60 + 70 + 80 + 90 + 100);
    expect(value(2, 3)).toBe(30 + 40);
    expect(value(3, 3)).toBe(9.5);
    expect(value(4, 3)).toBe(30);
    // Excel AND/OR: blanks in a range are ignored; the ten stored values are
    // all truthy, so both answer true however sparse the range is.
    expect(value(5, 3)).toBe(true);
    expect(value(6, 3)).toBe(true);
    expect(value(7, 3)).toBe(1 * 10 + 2 * 20 + 3 * 30 + 4 * 40 + 5 * 50 + 6 * 60 + 7 * 70 + 8 * 80 + 9 * 90 + 10 * 100);
    // Lookups walk the stored cells of a table beyond the dense ceiling.
    expect(value(8, 4)).toBe(30);
    expect(value(9, 4)).toBe(20); // approximate: the largest stored key ≤ 2.5
    // Blank-matching criteria reach the never-stored addresses arithmetically:
    // 2,000,001 − 10 blanks, and their aligned B values sum to nothing.
    expect(value(10, 4)).toBe(2_000_001 - 10);
    expect(value(11, 4)).toBe(0);
  }, 60_000);

  it('c3. AND/OR ignore blanks in ranges, Excel-style (sparse and dense)', () => {
    putValue(0, 0, 1);
    putValue(5, 0, 0);
    putFormula(0, 3, '=AND(A1:A2000001)');
    putFormula(1, 3, '=OR(A1:A2000001)');
    putFormula(2, 3, '=AND(A1:A3)'); // dense small range, A2:A3 empty
    expect(value(0, 3)).toBe(false); // the stored 0 counts
    expect(value(1, 3)).toBe(true); // the stored truthy 1 decides; blanks ignored
    expect(value(2, 3)).toBe(true); // dense: one truthy value, blanks ignored (Excel)
    store.setCell(5, 0, { text: '2', value: 2 });
    expect(value(0, 3)).toBe(true); // all counted values truthy — gaps no longer falsify (Excel)
    store.setCell(0, 0, { text: '' });
    store.setCell(5, 0, { text: '' });
    expect(value(0, 3)).toBe('#VALUE!'); // stored '' is ignored too: no logical value anywhere
    expect(value(1, 3)).toBe('#VALUE!');
    expect(value(2, 3)).toBe('#VALUE!'); // dense all-blank range (Excel)
  }, 60_000);

  it('c6. SUMIF over a sparse range with blank criteria counts sum-only positions', () => {
    for (let r = 0; r < 5; r += 1) putValue(r, 0, r + 1); // keys A1:A5
    putValue(7, 1, 100); putValue(8, 1, 200); putValue(9, 1, 300); // values B8:B10, keys absent there
    putFormula(0, 3, '=SUMIF(A1:A2000001, "", B1:B2000001)');
    putFormula(1, 3, '=COUNTIF(A1:A2000001, "=")');
    putFormula(2, 3, '=COUNTIF(A1:A2000001, ">2")');
    expect(value(0, 3)).toBe(600); // blank keys at B8:B10 rows — their stored values count
    expect(value(1, 3)).toBe(2_000_001 - 5); // every position without a stored number
    expect(value(2, 3)).toBe(3); // numeric criteria stay stored-only and exact
  }, 60_000);

  it('c4. an error literal anywhere in a huge range propagates through every aggregate', () => {
    for (let r = 0; r < 10; r += 1) putValue(r, 0, r + 1);
    store.setCell(4, 0, { text: '#N/A', value: '#N/A' });
    putFormula(0, 3, '=SUM(A1:A2000001)');
    putFormula(1, 3, '=COUNT(A1:A2000001)');
    putFormula(2, 3, '=COUNTBLANK(A1:A2000001)');
    putFormula(3, 3, '=COUNTIF(A1:A2000001, ">2")');
    expect(value(0, 3)).toBe('#N/A');
    expect(value(1, 3)).toBe('#N/A');
    expect(value(2, 3)).toBe('#N/A');
    expect(value(3, 3)).toBe('#N/A');
  }, 60_000);

  it('c5. a range over a missing sheet stays #REF! above the ceiling', () => {
    putFormula(0, 3, '=SUM(NoSuchSheet!A1:A2000001)');
    putFormula(1, 3, '=SUM(NoSuchSheet!A1:A3)');
    expect(value(0, 3)).toBe('#REF!');
    expect(value(1, 3)).toBe('#REF!');
  });
});
