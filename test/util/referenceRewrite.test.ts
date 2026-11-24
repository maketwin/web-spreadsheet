import { describe, expect, it } from 'vitest';
import { remapFormulaRows, shiftFormulaCols, shiftFormulaRows } from '../../src/util/cell';
import { shiftFormula } from '../../src/commands/impl/FillRange';
import { FormulaEngine } from '../../src/formula/FormulaEngine';
import { createFormulaSync } from '../../src/formula/formulaSync';
import { Store } from '../../src/store/Store';

// Reference rewriting used to be a plain regex over the formula text: it
// rewrote whatever looked like a cell, including text inside string literals
// and sheet names, and left off-grid references pointing where they used to.
describe('reference rewriting', () => {
  it('leaves string literals and sheet names alone', () => {
    expect(shiftFormulaRows('="Item A1"&B2', 0, 1)).toBe('="Item A1"&B3');
    expect(shiftFormula('="Total Q1"&B2', 1, 0)).toBe('="Total Q1"&B3');
    // Q1 is a sheet: its name is not a reference, the cell it scopes still moves.
    expect(shiftFormula('=Q1!B2', 1, 0)).toBe('=Q1!B3');
    expect(shiftFormulaRows('=Q1!B2', 0, 1)).toBe('=Q1!B2');
    expect(shiftFormulaRows('=Q1!B2', 0, 1, { sheetName: 'Q1' })).toBe('=Q1!B3');
    expect(shiftFormula("='My Q1'!B2&\"a1\"", 1, 0)).toBe("='My Q1'!B3&\"a1\"");
    // An escaped quote inside a literal must not end it.
    expect(shiftFormula('="say ""A1"" "&B2', 1, 0)).toBe('="say ""A1"" "&B3');
  });

  it('moves lowercase references and keeps their case', () => {
    expect(shiftFormula('=a1*2', 1, 0)).toBe('=a2*2');
    expect(shiftFormulaRows('=sum(a1:a5)', 0, 1)).toBe('=sum(a2:a6)');
  });

  it('respects $ anchors and skips function names and numbers', () => {
    expect(shiftFormula('=$A$1+A1', 1, 1)).toBe('=$A$1+B2');
    expect(shiftFormula('=LOG10(A1)+1.5E3', 1, 0)).toBe('=LOG10(A2)+1.5E3');
    expect(shiftFormula('=Sheet2!A1+B2', 0, 1)).toBe('=Sheet2!B1+C2');
  });

  it('turns a relative reference pushed off the grid into #REF!', () => {
    expect(shiftFormula('=SUM(A1:A5)', -1, 0)).toBe('=SUM(#REF!)');
    expect(shiftFormula('=B2', 0, -1)).toBe('=A2');
    expect(shiftFormula('=A1', 0, -1)).toBe('=#REF!');
    // A whole range dies with either endpoint; an anchored endpoint survives.
    expect(shiftFormula('=SUM($A$1:A5)', -1, 0)).toBe('=SUM($A$1:A4)');
    expect(shiftFormula('=Z1', 0, 1)).toBe('=#REF!');
  });

  it('keeps Excel delete semantics for ranges', () => {
    // Deleting row 1 shrinks the range; a range deleted entirely is gone.
    expect(shiftFormulaRows('=SUM(A1:A5)', 0, -1)).toBe('=SUM(A1:A4)');
    expect(shiftFormulaRows('=SUM(A1:A1)', 0, -1)).toBe('=SUM(#REF!)');
    expect(shiftFormulaRows('=A1+A$3', 0, -1)).toBe('=#REF!+A$2');
    expect(shiftFormulaCols('=SUM(B1:C1)', 1, -2)).toBe('=SUM(#REF!)');
  });

  it('remaps sorted rows without touching literals', () => {
    const rows = new Map([[0, 2], [2, 0]]);
    expect(remapFormulaRows('=SUM(A1:A3)+"A1"', rows, 0, 0)).toBe('=SUM(A1:A3)+"A1"');
    expect(remapFormulaRows('=A1+A2', rows, 0, 0)).toBe('=A3+A2');
  });
});

describe('INDIRECT with a literal target', () => {
  it('recalculates when the target changes', () => {
    const store = new Store();
    const engine = new FormulaEngine(store);
    createFormulaSync(store, engine);
    const put = (c: number, text: string): void => { store.setCell(0, c, text.startsWith('=') ? { text, formula: text } : { text, value: Number(text) }); };
    put(0, '1');
    put(1, '=INDIRECT("A1")');
    put(2, '=INDIRECT("$A$1")+INDIRECT("Sheet1!A1")');
    expect(store.getCell(0, 1)?.value).toBe(1);
    put(0, '2');
    expect(store.getCell(0, 1)?.value).toBe(2);
    expect(store.getCell(0, 2)?.value).toBe(4);
  });
});
