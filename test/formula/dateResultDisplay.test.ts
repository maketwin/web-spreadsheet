import { describe, expect, it } from 'vitest';
import { Store } from '../../src/store/Store';
import { FormulaEngine } from '../../src/formula/FormulaEngine';
import { createFormulaSync } from '../../src/formula/formulaSync';
import { displayTextOf } from '../../src/util/cell';

// A date is its serial number (so it takes part in arithmetic), but a formula
// whose result is a date shows a date — Excel does not print =TODAY() as 46349.
describe('date formula results', () => {
  function setup(): { store: Store; put: (r: number, c: number, formula: string) => void; at: (r: number, c: number) => { value: unknown; text: string } } {
    const store = new Store();
    createFormulaSync(store, new FormulaEngine(store));
    const put = (r: number, c: number, formula: string): void => { store.setCell(r, c, { text: formula, formula }); };
    const at = (r: number, c: number) => { const cell = store.getCell(r, c)!; return { value: cell.value, text: displayTextOf(cell, store.getStyle(cell.styleId ?? '', undefined)) }; };
    return { store, put, at };
  }

  it('shows TODAY(), DATE() and a number of days added to either as dates', () => {
    const { put, at } = setup();
    put(0, 0, '=DATE(2024,1,1)');
    put(1, 0, '=DATE(2024,1,1)+1');
    put(2, 0, '=DATE(2024,1,1)-1');
    put(3, 0, '=TODAY()');
    expect(at(0, 0)).toEqual({ value: 45292, text: '2024-01-01' });
    expect(at(1, 0)).toEqual({ value: 45293, text: '2024-01-02' });
    expect(at(2, 0)).toEqual({ value: 45291, text: '2023-12-31' });
    // TODAY(): a serial number shown as a date (the day itself depends on the clock).
    expect(at(3, 0).text).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('shows NOW() with its time, and the difference of two dates as a plain number', () => {
    const { put, at } = setup();
    put(0, 0, '=NOW()');
    put(1, 0, '=DATE(2024,1,10)-DATE(2024,1,1)');
    expect(at(0, 0).text).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(at(1, 0)).toEqual({ value: 9, text: '9' });
  });

  it('still calculates with the serial number behind the display', () => {
    const { put, at } = setup();
    put(0, 0, '=DATE(2024,1,1)');
    put(1, 0, '=YEAR(A1)&"-"&MONTH(A1)&"-"&DAY(A1)');
    put(2, 0, '=A1+31');
    put(3, 0, '=A1>DATE(2023,12,31)');
    expect(at(1, 0).text).toBe('2024-1-1');
    expect(at(2, 0)).toEqual({ value: 45323, text: '2024-02-01' });
    expect(at(3, 0).value).toBe(true);
  });

  it('lets a number format on the cell decide the display', () => {
    const { store, put, at } = setup();
    store.setStyle('num', { numberFormat: 'number' });
    put(0, 0, '=DATE(2024,1,1)');
    store.setCell(0, 0, { ...store.getCell(0, 0)!, styleId: 'num' });
    expect(at(0, 0).text).toBe('45,292.00');
  });

  it('keeps a non-date result out of the date display', () => {
    const { put, at } = setup();
    put(0, 0, '=45292');
    put(1, 0, '=DATE(2024,1,1)-DATE(2024,1,1)');
    expect(at(0, 0).text).toBe('45292');
    expect(at(1, 0).text).toBe('0');
  });
});

describe('small Excel parity items', () => {
  function eval1(formula: string): unknown {
    const store = new Store();
    const engine = new FormulaEngine(store);
    engine.setFormula('0,0', formula, []);
    return store.getCell(0, 0)?.value;
  }

  it('NA() gives #N/A, which ISNA sees and ISERR does not', () => {
    expect(eval1('=NA()')).toBe('#N/A');
    expect(eval1('=ISNA(NA())')).toBe(true);
    expect(eval1('=ISERR(NA())')).toBe(false);
  });

  it('ROUND rounds halves away from zero', () => {
    expect(eval1('=ROUND(-2.5,0)')).toBe(-3);
    expect(eval1('=ROUND(2.5,0)')).toBe(3);
    expect(eval1('=ROUND(-2.675,2)')).toBe(-2.68);
    expect(eval1('=ROUND(2.675,2)')).toBe(2.68);
  });

  it('SORT leaves a single row alone unless asked to sort by column, like Excel', () => {
    const store = new Store();
    const engine = new FormulaEngine(store);
    createFormulaSync(store, engine);
    ['3', '1', '2'].forEach((text, c) => { store.setCell(5, c, { text, value: Number(text) }); });
    store.setCell(0, 0, { text: '=SORT(A6:C6)', formula: '=SORT(A6:C6)' });
    expect([0, 1, 2].map((c) => store.getCell(0, c)?.value)).toEqual([3, 1, 2]);
    store.setCell(1, 0, { text: '=SORT(A6:C6,1,1,TRUE)', formula: '=SORT(A6:C6,1,1,TRUE)' });
    expect([0, 1, 2].map((c) => store.getCell(1, c)?.value)).toEqual([1, 2, 3]);
  });
});
