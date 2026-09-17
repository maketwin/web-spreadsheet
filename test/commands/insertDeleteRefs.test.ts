import { describe, expect, it } from 'vitest';
import { DeleteColCommand, DeleteRowCommand, InsertColCommand, InsertRowCommand } from '../../src/index';
import { createFormulaSync } from '../../src/components/Spreadsheet';
import { FormulaEngine } from '../../src/formula/FormulaEngine';
import { Store } from '../../src/store/Store';
import { shiftFormulaCols, shiftFormulaRows } from '../../src/util/cell';

describe('shiftFormulaRows', () => {
  it('shifts single refs at and below the insert', () => {
    expect(shiftFormulaRows('=A5', 4, 1)).toBe('=A6');
    expect(shiftFormulaRows('=A5', 5, 1)).toBe('=A5');
    expect(shiftFormulaRows('=A5', 0, 2)).toBe('=A7');
  });

  it('grows ranges at shifted endpoints and expands around interior inserts (Excel)', () => {
    expect(shiftFormulaRows('=SUM(B2:B10)', 4, 1)).toBe('=SUM(B2:B11)');
    // Inserting inside the range expands it: new row 2 is within A1:A3.
    expect(shiftFormulaRows('=SUM(A1:A3)', 1, 1)).toBe('=SUM(A1:A4)');
    // Inserting at the top shifts both endpoints.
    expect(shiftFormulaRows('=SUM(A1:A3)', 0, 1)).toBe('=SUM(A2:A4)');
    expect(shiftFormulaRows('=SUM(B2:B10)', 10, 1)).toBe('=SUM(B2:B10)');
  });

  it('moves refs on delete and turns deleted refs into #REF!', () => {
    expect(shiftFormulaRows('=A7', 4, -1)).toBe('=A6');
    expect(shiftFormulaRows('=A5', 4, -1)).toBe('=#REF!');
  });

  it('shrinks ranges on delete; a fully deleted range becomes #REF!', () => {
    expect(shiftFormulaRows('=SUM(B5:B10)', 4, -1)).toBe('=SUM(B5:B9)');
    expect(shiftFormulaRows('=SUM(B5:B10)', 4, -2)).toBe('=SUM(B5:B8)');
    expect(shiftFormulaRows('=SUM(B5:B7)', 4, -3)).toBe('=SUM(#REF!)');
  });

  it('preserves $ anchors', () => {
    expect(shiftFormulaRows('=$A$5+$A6+A$7', 4, 1)).toBe('=$A$6+$A7+A$8');
  });

  it('leaves other-sheet scoped refs alone unless the scope names the shifted sheet', () => {
    expect(shiftFormulaRows('=Sheet2!A5', 4, 1, { sheetName: 'Sheet1' })).toBe('=Sheet2!A5');
    expect(shiftFormulaRows('=Sheet1!A5', 4, 1, { sheetName: 'Sheet1' })).toBe('=Sheet1!A6');
    expect(shiftFormulaRows('=A5+Sheet1!A5', 4, 1, { sheetName: 'Sheet1', scopedOnly: true })).toBe('=A5+Sheet1!A6');
  });

  it('does not rewrite tokens glued into identifiers', () => {
    expect(shiftFormulaRows('=SUM(A1:A3)', 0, 1)).toBe('=SUM(A2:A4)');
    expect(shiftFormulaRows('=1E-5+A1', 0, 1)).toBe('=1E-5+A2');
  });
});

describe('shiftFormulaCols', () => {
  it('shifts, deletes, and grows like the row variant', () => {
    expect(shiftFormulaCols('=B2', 1, 1)).toBe('=C2');
    expect(shiftFormulaCols('=B2', 1, -1)).toBe('=#REF!');
    expect(shiftFormulaCols('=SUM(B1:D1)', 2, 1)).toBe('=SUM(B1:E1)');
    expect(shiftFormulaCols('=SUM(B1:D1)', 1, -1)).toBe('=SUM(B1:C1)');
    expect(shiftFormulaCols('=$B$2', 1, 1)).toBe('=$C$2');
  });
});

describe('insert/delete commands rewrite formulas', () => {
  function setup(): { store: Store; engine: FormulaEngine; unsubscribe: () => void } {
    const store = new Store();
    const engine = new FormulaEngine(store);
    const sync = createFormulaSync(store, engine);
    store.setCell(0, 0, { text: '3' });
    store.setCell(0, 1, { formula: '=A1', text: '' });
    return { store, engine, unsubscribe: sync.unsubscribe };
  }

  it('inserting a row above rewrites the formula and keeps the value', () => {
    const { store, unsubscribe } = setup();
    new InsertRowCommand({ r: 0, count: 1 }).execute(store);
    expect(store.getCell(0, 0)).toBeUndefined();
    expect(store.getCell(1, 0)?.text).toBe('3');
    expect(store.getCell(1, 1)?.formula).toBe('=A2');
    expect(store.getCell(1, 1)?.text).toBe('3');
    unsubscribe();
  });

  it('undoing the insert restores the original formula', () => {
    const { store, unsubscribe } = setup();
    const cmd = new InsertRowCommand({ r: 0, count: 1 });
    cmd.execute(store);
    cmd.getUndo().execute(store);
    expect(store.getCell(0, 0)?.text).toBe('3');
    expect(store.getCell(0, 1)?.formula).toBe('=A1');
    unsubscribe();
  });

  it('deleting a referenced row yields #REF!', () => {
    const { store, unsubscribe } = setup();
    // Formula sits below the deleted row: it shifts up and its ref dies.
    store.setCell(4, 1, { formula: '=A1', text: '' });
    new DeleteRowCommand({ r: 0, count: 1 }).execute(store);
    expect(store.getCell(0, 0)).toBeUndefined();
    expect(store.getCell(3, 1)?.formula).toBe('=#REF!');
    expect(store.getCell(3, 1)?.text).toBe('#REF!');
    unsubscribe();
  });

  it('inserting a column shifts column references', () => {
    const { store, unsubscribe } = setup();
    new InsertColCommand({ c: 0, count: 1 }).execute(store);
    // Both cells moved right by one: data now B1, formula at C1.
    expect(store.getCell(0, 2)?.formula).toBe('=B1');
    expect(store.getCell(0, 2)?.text).toBe('3');
    unsubscribe();
  });

  it('deleting a referenced column yields #REF!', () => {
    const { store, unsubscribe } = setup();
    store.setCell(0, 2, { formula: '=A1', text: '' });
    new DeleteColCommand({ c: 0, count: 1 }).execute(store);
    expect(store.getCell(0, 1)?.formula).toBe('=#REF!');
    unsubscribe();
  });

  it('rewrites cross-sheet references pointing at the edited sheet (and undo restores them)', () => {
    const store = new Store();
    const engine = new FormulaEngine(store);
    const sync = createFormulaSync(store, engine);
    store.setCell(0, 0, { text: '7' }, 'sheet-1'); // Sheet1!A1
    const sheet2 = store.addSheet('Sheet2');
    store.setCell(0, 0, { formula: '=Sheet1!A1', text: '' }, sheet2);
    store.activateSheet('sheet-1');

    const cmd = new InsertRowCommand({ r: 0, count: 1 });
    cmd.execute(store);
    expect(store.getCell(0, 0, sheet2)?.formula).toBe('=Sheet1!A2');
    expect(store.getCell(0, 0, sheet2)?.text).toBe('7');

    cmd.getUndo().execute(store);
    expect(store.getCell(0, 0, sheet2)?.formula).toBe('=Sheet1!A1');
    sync.unsubscribe();
  });
});

describe('grid edge clamping (Excel)', () => {
  it('clamps refs that would move past the last row/col', () => {
    expect(shiftFormulaRows('=A1000', 0, 1)).toBe('=A1000');
    expect(shiftFormulaRows('=SUM(A1:A1000)', 999, 1)).toBe('=SUM(A1:A1000)');
    expect(shiftFormulaCols('=Z1', 0, 1)).toBe('=Z1');
    expect(shiftFormulaCols('=SUM(A1:Z1)', 25, 1)).toBe('=SUM(A1:Z1)');
  });
});

describe('insert/delete shifts non-formula structures', () => {
  function setupSheet(): Store {
    const store = new Store();
    store.setCell(0, 0, { text: '1' });
    return store;
  }

  it('shifts a named range on insert and restores it on undo', () => {
    const store = setupSheet();
    store.setNamedRange('Total', { range: '4,0:9,0' });
    const cmd = new InsertRowCommand({ r: 0, count: 1 });
    cmd.execute(store);
    expect(store.getNamedRange('Total')?.range).toBe('5,0:10,0');
    cmd.getUndo().execute(store);
    expect(store.getNamedRange('Total')?.range).toBe('4,0:9,0');
  });

  it('drops a named range whose cells are fully deleted', () => {
    const store = setupSheet();
    store.setNamedRange('Gone', { range: '2,0:3,0' });
    new DeleteRowCommand({ r: 2, count: 2 }).execute(store);
    expect(store.getNamedRange('Gone')).toBeUndefined();
  });

  it('does not shift a named range pointing at another sheet', () => {
    const store = setupSheet();
    const sheet2 = store.addSheet('Sheet2'); // addSheet activates the new sheet
    store.setNamedRange('Remote', { range: '4,0:9,0', sheetId: sheet2 });
    store.activateSheet('sheet-1');
    new InsertRowCommand({ r: 0, count: 1 }).execute(store);
    expect(store.getNamedRange('Remote', sheet2)?.range).toBe('4,0:9,0');
  });

  it('moves conditional format and validation ranges with the rows', () => {
    const store = setupSheet();
    store.setConditionalRule('4,0:9,0', [{ type: 'dataBar', min: 0, max: 100, color: '#4A90D9' }]);
    store.setValidationRule('4,0', { type: 'list', values: ['a', 'b'] });
    const cmd = new InsertRowCommand({ r: 0, count: 1 });
    cmd.execute(store);
    expect(store.getConditionalRules().map(([range]) => range)).toEqual(['5,0:10,0']);
    expect(store.getValidationRules().map(([range]) => range)).toEqual(['5,0']);
    cmd.getUndo().execute(store);
    expect(store.getConditionalRules().map(([range]) => range)).toEqual(['4,0:9,0']);
    expect(store.getValidationRules().map(([range]) => range)).toEqual(['4,0']);
  });

  it('drops a conditional format whose range is fully deleted', () => {
    const store = setupSheet();
    store.setConditionalRule('2,0:3,0', [{ type: 'dataBar', min: 0, max: 100, color: '#4A90D9' }]);
    new DeleteRowCommand({ r: 2, count: 2 }).execute(store);
    expect(store.getConditionalRules()).toEqual([]);
  });

  it('shifts the autofilter range and re-keys column criteria', () => {
    const store = setupSheet();
    store.setCell(0, 1, { text: 'h' });
    store.setAutoFilter({ range: { r1: 0, c1: 0, r2: 9, c2: 2 }, criteria: { 1: { selected: ['h'], includeBlanks: false } } });
    new InsertRowCommand({ r: 0, count: 1 }).execute(store);
    expect(store.getAutoFilter()?.range).toEqual({ r1: 1, c1: 0, r2: 10, c2: 2 });
    expect(store.getAutoFilter()?.criteria[1]).toEqual({ selected: ['h'], includeBlanks: false });

    new InsertColCommand({ c: 0, count: 1 }).execute(store);
    expect(store.getAutoFilter()?.range.c1).toBe(1);
    expect(store.getAutoFilter()?.criteria[2]).toEqual({ selected: ['h'], includeBlanks: false });
    expect(store.getAutoFilter()?.criteria[1]).toBeUndefined();
  });

  it('clears the autofilter when its range is fully deleted', () => {
    const store = setupSheet();
    store.setAutoFilter({ range: { r1: 2, c1: 0, r2: 3, c2: 1 }, criteria: {} });
    new DeleteRowCommand({ r: 2, count: 2 }).execute(store);
    expect(store.getAutoFilter()).toBeUndefined();
  });
});
