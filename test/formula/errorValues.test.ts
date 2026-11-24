import { describe, expect, it } from 'vitest';
import { FormulaParser } from '../../src/formula/parser';
import { evaluate } from '../../src/formula/evaluator';
import { registry } from '../../src/formula/registry';
import { EXCEL_ERRORS } from '../../src/formula/types';
import type { CellResolver, FormulaValue } from '../../src/formula/types';
import { FormulaEngine } from '../../src/formula/FormulaEngine';
import { Store } from '../../src/store/Store';
import { createFormulaSync } from '../../src/components/Spreadsheet';
import { DeleteRowCommand } from '../../src/commands/impl/DeleteRow';
import { API_ERROR, MockHub } from '../../src/platform/MockHub';
import { apiFunctionSpecs } from '../../src/platform/apiFunctions';
import type { ApiInterface, ApiRule, MockProject } from '../../src/platform/types';

const parser = new FormulaParser();

/** Evaluate `=expr` with A1-style cells served from `cells`; arrays report their first element. */
function calc(expr: string, cells: Record<string, FormulaValue> = {}): FormulaValue {
  const ast = parser.parse(expr);
  if (ast === null) throw new Error(`parse failed: ${expr}`);
  const resolve: CellResolver = (x, y) => cells[`${String.fromCharCode(65 + x)}${y + 1}`] ?? null;
  const result = evaluate(ast, resolve);
  return (Array.isArray(result) ? (result[0] ?? null) : result) as FormulaValue;
}

/** Run a formula through the engine the way a typed cell does and report the stored value.
 * Formulas planted by `seed` are registered first, like the UI's sync layer does on load. */
function run(formula: string, seed: (store: Store) => void = () => undefined): unknown {
  const store = new Store();
  const engine = new FormulaEngine(store);
  seed(store);
  store.getCells().forEach(([id, cell]) => {
    const text = cell.formula ?? (cell.text.startsWith('=') ? cell.text : undefined);
    if (text !== undefined) engine.setFormula(id, text, []);
  });
  store.setCell(9, 9, { text: formula });
  engine.setFormula('9,9', formula, []);
  return store.getCell(9, 9)?.value;
}

const ALL_ERRORS = ['#NULL!', '#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#NUM!', '#N/A', '#SPILL!', '#CALC!', '#API!'] as const;

describe('one error table', () => {
  it('lists the classic seven, the dynamic-array errors and the Mock platform failure', () => {
    expect([...EXCEL_ERRORS]).toEqual([...ALL_ERRORS]);
    // The platform bridge hands out API_ERROR verbatim; it must be a known error or nothing would catch it.
    expect(API_ERROR).toBe('#API!');
    expect(EXCEL_ERRORS.has(API_ERROR)).toBe(true);
  });

  it('ISTEXT excludes every error literal, not only the classic seven', () => {
    for (const err of ALL_ERRORS) expect(calc('=ISTEXT(A1)', { A1: err })).toBe(false);
    expect(calc('=ISTEXT(A1)', { A1: '#tag' })).toBe(true);
  });
});

describe('ISERROR / ISERR / ISNA agree with IFERROR / IFNA', () => {
  it('ISERROR is true for every error literal and false for plain #-text', () => {
    for (const err of ALL_ERRORS) expect(calc('=ISERROR(A1)', { A1: err })).toBe(true);
    expect(calc('=ISERROR(A1)', { A1: '#tag' })).toBe(false);
    expect(calc('=ISERROR(A1)', { A1: 5 })).toBe(false);
    expect(calc('=ISERROR(1/0)')).toBe(true);
  });

  it('ISERR is every error except #N/A', () => {
    for (const err of ALL_ERRORS) expect(calc('=ISERR(A1)', { A1: err })).toBe(err !== '#N/A');
    expect(calc('=ISERR(A1)', { A1: '#tag' })).toBe(false);
  });

  it('ISNA is #N/A only', () => {
    for (const err of ALL_ERRORS) expect(calc('=ISNA(A1)', { A1: err })).toBe(err === '#N/A');
  });

  it('IFERROR catches what ISERROR reports; IFNA catches what ISNA reports', () => {
    for (const err of ALL_ERRORS) {
      expect(calc('=IFERROR(A1,"caught")', { A1: err })).toBe('caught');
      expect(calc('=IFNA(A1,"caught")', { A1: err })).toBe(err === '#N/A' ? 'caught' : err);
    }
    expect(calc('=IFERROR(A1,"caught")', { A1: '#tag' })).toBe('#tag');
  });

  it('ISERROR sees a blocked spill anchor (the #SPILL! case)', () => {
    const blocked = (store: Store): void => {
      store.setCell(1, 0, { text: 'blocker' });
      store.setCell(0, 0, { text: '=SEQUENCE(3)' });
    };
    expect(run('=A1', blocked)).toBe('#SPILL!'); // the anchor really holds the error
    expect(run('=ISERROR(A1)', blocked)).toBe(true);
    expect(run('=ISERR(A1)', blocked)).toBe(true);
    expect(calc('=ISERROR(A1)', { A1: '#SPILL!' })).toBe(true);
  });
});

describe('aggregates propagate error values found in ranges', () => {
  const err = { A1: 1, A2: '#API!', A3: 2 };

  it('SUM / AVERAGE / COUNT / COUNTA / MAX / MIN return the error instead of skipping it', () => {
    for (const fn of ['SUM', 'AVERAGE', 'COUNT', 'COUNTA', 'MAX', 'MIN']) {
      expect(calc(`=${fn}(A1:A3)`, err), fn).toBe('#API!');
      expect(calc(`=${fn}(A1:A3)`, { A1: 1, A2: '#SPILL!', A3: 2 }), fn).toBe('#SPILL!');
    }
    // Without the error the same ranges add up as before.
    expect(calc('=SUM(A1:A3)', { A1: 1, A2: 'abc', A3: 2 })).toBe(3);
    expect(calc('=COUNT(A1:A3)', { A1: 1, A2: 'abc', A3: 2 })).toBe(2);
  });

  it('the conditional aggregates and SUBTOTAL follow suit', () => {
    expect(calc('=SUMIF(A1:A3,">0")', err)).toBe('#API!');
    expect(calc('=COUNTIF(A1:A3,">0")', err)).toBe('#API!');
    expect(calc('=AVERAGEIF(A1:A3,">0")', err)).toBe('#API!');
    expect(calc('=SUBTOTAL(9,A1:A3)', err)).toBe('#API!');
    expect(calc('=SUBTOTAL(9,A1:A3)', { A1: 1, A3: 2 })).toBe(3);
    expect(calc('=SUMPRODUCT(A1:A3,A1:A3)', err)).toBe('#API!');
  });

  it('SUBTOTAL ignores an error on a hidden row, like any other value there', () => {
    const ast = parser.parse('=SUBTOTAL(9,A1:A3)');
    expect(ast).not.toBeNull();
    const resolve: CellResolver = (_x, y) => [1, '#API!', 2][y] ?? null;
    expect(evaluate(ast!, resolve, undefined, { isRowHidden: (row) => row === 1 })).toBe(3);
    expect(evaluate(ast!, resolve, undefined, { isRowHidden: (row) => row !== 1 })).toBe('#API!');
  });

  it('the error-inspecting functions still see through it', () => {
    expect(calc('=ISERROR(SUM(A1:A3))', err)).toBe(true);
    expect(calc('=IFERROR(SUM(A1:A3),0)', err)).toBe(0);
  });
});

describe('error literals written in the formula itself', () => {
  // Deleting a referenced range rewrites the formula to a bare #REF! token; the
  // parser yields the string '#REF!' and every consumer must treat it as an error.
  it('=SUM(#REF!) is #REF!, not 0', () => {
    expect(calc('=SUM(#REF!)')).toBe('#REF!');
    expect(calc('=SUM(#REF!,1)')).toBe('#REF!');
    expect(calc('=SUM(1,#REF!)')).toBe('#REF!');
    expect(calc('=SUM(A1:A3,#REF!)', { A1: 1 })).toBe('#REF!');
    // Every literal without a "/" in it parses to its own error string.
    // (#DIV/0! and #N/A typed into a formula are split at the "/" by the
    // parser's operator scan — a parser limitation, not an evaluation one.)
    for (const e of ALL_ERRORS) {
      expect(calc('=SUM(A1:A3)', { A1: 1, A2: e, A3: 2 }), e).toBe(e);
      if (!e.includes('/')) expect(calc(`=SUM(${e})`), e).toBe(e);
    }
  });

  it('every operator propagates it', () => {
    for (const op of ['+#REF!', '#REF!+1', '1-#REF!', '#REF!*2', '1/#REF!', '#REF!^2', '#REF!&"x"', '#REF!=1', '1=#REF!', '#REF!>1', '#REF!<>1', '1<=#REF!']) {
      expect(calc(`=${op}`), op).toBe('#REF!');
    }
    expect(calc('=-#REF!')).toBe('#REF!');
    expect(calc('=-A1', { A1: '#SPILL!' })).toBe('#SPILL!');
    expect(calc('=--A1', { A1: '#API!' })).toBe('#API!');
    expect(calc('=SUM(A1:A3*2)', { A1: 1, A2: '#DIV/0!', A3: 3 })).toBe('#DIV/0!');
    expect(calc('=SUMPRODUCT((A1:A3>0)*A1:A3)', { A1: 1, A2: '#CALC!', A3: 3 })).toBe('#CALC!');
  });

  it('text that merely starts with # is still text', () => {
    expect(calc('=SUM(A1:A3)', { A1: 1, A2: '#tag', A3: 2 })).toBe(3);
    expect(calc('=COUNTA(A1:A3)', { A1: 1, A2: '#tag', A3: 2 })).toBe(3);
    expect(calc('=A1+1', { A1: '#tag' })).toBe('#VALUE!');
    expect(calc('=ISERROR(A1)', { A1: '#tag' })).toBe(false);
  });

  it('scalar functions propagate it, the IS* / IFERROR family inspects it', () => {
    for (const f of ['ABS', 'LEN', 'ROUND', 'NOT', 'CONCAT', 'AVERAGE', 'COUNT', 'COUNTA', 'MAX', 'MIN', 'COUNTIF', 'SUMIF', 'AVERAGEIF', 'IF', 'AND', 'OR']) {
      // IF/AND/OR take the error first; COUNTIF/SUMIF/AVERAGEIF need a range before the criterion.
      const args = f === 'IF' ? '#REF!,1,2' : (f === 'AND' || f === 'OR') ? '#REF!,TRUE'
        : (f === 'COUNTIF' || f === 'SUMIF') ? 'A1:A3,#REF!' : f === 'AVERAGEIF' ? 'A1:A3,#REF!' : f === 'ROUND' ? '#REF!,1' : '#REF!';
      expect(calc(`=${f}(${args})`), f).toBe('#REF!');
    }
    expect(calc('=IF(#REF!,1,2)')).toBe('#REF!');
    expect(calc('=IFERROR(#REF!,"caught")')).toBe('caught');
    expect(calc('=IFNA(#REF!,"caught")')).toBe('#REF!');
    expect(calc('=ISERROR(#REF!)')).toBe(true);
    expect(calc('=ISBLANK(#REF!)')).toBe(false);
    expect(calc('=ISNUMBER(#REF!)')).toBe(false);
    expect(calc('=IF(TRUE,1,#REF!)')).toBe(1); // the untaken branch stays lazy
  });

  it('lookup and reference functions return the error of their argument', () => {
    const table = { B1: 'a', C1: 10, B2: 'b', C2: 20, B3: 'c', C3: 30 };
    expect(calc('=VLOOKUP(#REF!,B1:C3,2,0)', table)).toBe('#REF!');
    expect(calc('=VLOOKUP("b",B1:C3,#REF!,0)', table)).toBe('#REF!');
    expect(calc('=HLOOKUP(#NUM!,B1:C1,1,0)', table)).toBe('#NUM!');
    expect(calc('=XLOOKUP(#SPILL!,B1:B3,C1:C3)', table)).toBe('#SPILL!');
    expect(calc('=XLOOKUP("b",B1:B3,C1:C3,"miss")', table)).toBe(20); // a clean lookup is untouched
    expect(calc('=XLOOKUP("zz",B1:B3,C1:C3,"miss")', table)).toBe('miss'); // a real miss still takes if_not_found
    expect(calc('=INDEX(C1:C3,#REF!)', table)).toBe('#REF!');
    expect(calc('=MATCH(#REF!,B1:B3,0)', table)).toBe('#REF!');
    expect(calc('=SUBTOTAL(9,#REF!)')).toBe('#REF!');
    expect(calc('=OFFSET(B1,#REF!,0)', table)).toBe('#REF!');
    expect(calc('=INDIRECT(#NAME?)')).toBe('#NAME?');
    // The classic ten, each one propagating unchanged through the engine's resolver.
    for (const e of ALL_ERRORS) {
      expect(calc('=SUM(A1:A3)', { A1: 1, A2: e, A3: 2 }), e).toBe(e);
      expect(calc('=VLOOKUP(A2,B1:C3,2,0)', { ...table, A2: e }), e).toBe(e);
    }
  });
});

describe('a deleted reference reaches the formula as #REF! end to end', () => {
  function workbook(): { store: Store; unsubscribe: () => void } {
    const store = new Store();
    const sync = createFormulaSync(store, new FormulaEngine(store)); // registers and recalculates like the UI
    return { store, unsubscribe: sync.unsubscribe };
  }

  it('=SUM(A1:A3) over rows that are deleted evaluates to #REF! and feeds on as an error', () => {
    const { store, unsubscribe } = workbook();
    try {
      store.setCell(0, 0, { text: '1' }); store.setCell(1, 0, { text: '2' }); store.setCell(2, 0, { text: '3' });
      // Entered the way the UI stores a formula (formula field, not raw text).
      store.setCell(4, 4, { formula: '=SUM(A1:A3)', text: '' });
      store.setCell(5, 4, { formula: '=E5*2+1', text: '' });
      store.setCell(6, 4, { formula: '=SUM(E5,1)', text: '' });
      store.setCell(7, 4, { formula: '=IFERROR(E5,"caught")', text: '' });
      store.setCell(8, 4, { formula: '=ISERROR(E5)', text: '' });
      expect(store.getCell(4, 4)?.value).toBe(6);
      expect(store.getCell(5, 4)?.value).toBe(13);

      new DeleteRowCommand({ r: 0, count: 3 }).execute(store);

      const movedRow = 1; // E5 moved up by the three deleted rows
      expect(store.getCell(movedRow, 4)?.formula).toBe('=SUM(#REF!)');
      expect(store.getCell(movedRow, 4)?.value).toBe('#REF!');
      expect(store.getCell(movedRow + 1, 4)?.value).toBe('#REF!'); // =E2*2+1
      expect(store.getCell(movedRow + 2, 4)?.value).toBe('#REF!'); // =SUM(E2,1) — not 1
      expect(store.getCell(movedRow + 3, 4)?.value).toBe('caught');
      expect(store.getCell(movedRow + 4, 4)?.value).toBe(true);
    } finally { unsubscribe(); }
  });

  it('a range holding an engine-written error (blocked spill, 1/0, #API!) propagates through SUM', () => {
    const { store, unsubscribe } = workbook();
    try {
      store.setCell(1, 0, { text: 'blocker' });
      store.setCell(0, 0, { formula: '=SEQUENCE(3)', text: '' }); // A1 collapses to #SPILL!
      store.setCell(2, 0, { formula: '=1/0', text: '' }); // A3 → #DIV/0!
      store.setCell(0, 2, { text: '#API!' }); // C1 → what a failed API.GET leaves
      store.setCell(0, 3, { formula: '=SUM(A1:A3)', text: '' });
      store.setCell(1, 3, { formula: '=SUM(C1:C1,5)', text: '' });
      store.setCell(2, 3, { formula: '=SUM(A1:A3,5)', text: '' });
      expect(store.getCell(0, 0)?.value).toBe('#SPILL!');
      expect(store.getCell(2, 0)?.value).toBe('#DIV/0!');
      expect(store.getCell(0, 3)?.value).toBe('#SPILL!');
      expect(store.getCell(1, 3)?.value).toBe('#API!');
      expect(store.getCell(2, 3)?.value).toBe('#SPILL!');
    } finally { unsubscribe(); }
  });
});

describe('#API! through the Mock platform bridge', () => {
  const iface: ApiInterface = { id: 'gone', name: '已下线', method: 'GET', urlPattern: '/api/gone-err', fallback: 'error' };
  const rule: ApiRule = { id: 'r', interfaceId: 'kpi', name: 'KPI', matchers: {}, response: { kind: 'static', body: { v: 7 } }, fault: 'none', enabled: true, priority: 10 };
  const kpi: ApiInterface = { id: 'kpi', name: 'KPI', method: 'GET', urlPattern: '/api/kpi', fallback: 'error' };
  const project: MockProject = {
    name: 'p', interfaces: [kpi, iface], rules: [rule],
    scenarios: [{ id: 's1', name: 'S1', description: '', rules: { kpi: 'r' } }],
  };

  it('is an ordinary error for the formula engine', () => {
    const specs = apiFunctionSpecs(new MockHub(project));
    registry.register('API.GET', specs.GET);
    expect(calc('=API.GET("/api/gone-err")')).toBe(API_ERROR);
    expect(calc('=ISERROR(API.GET("/api/gone-err"))')).toBe(true);
    expect(calc('=IFERROR(API.GET("/api/gone-err"),"fallback")')).toBe('fallback');
    // A total over a failed fetch must not read as a clean 0.
    expect(calc('=SUM(B1:B2)', { B1: API_ERROR, B2: 3 })).toBe('#API!');
    expect(calc('=API.GET("/api/kpi?region=a","v")')).toBe(7);
  });
});
