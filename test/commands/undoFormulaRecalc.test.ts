import { describe, expect, it } from 'vitest';
import { SortRangeCommand } from '../../src/commands/impl/SortRange';
import { SetCellText } from '../../src/commands/impl/SetCellText';
import { createFormulaSync } from '../../src/components/Spreadsheet';
import { FormulaEngine } from '../../src/formula/FormulaEngine';
import { Store } from '../../src/store/Store';
import { formulaDependencies, formulaText } from '../../src/util/cell';

function setup(): { store: Store; engine: FormulaEngine; unsubscribe: () => void } {
  const store = new Store();
  const engine = new FormulaEngine(store);
  const sync = createFormulaSync(store, engine);
  store.setCell(0, 0, { text: '3' });
  store.setCell(1, 0, { text: '1' });
  store.setCell(2, 0, { text: '2' });
  store.setCell(0, 1, { formula: '=SUM(A1:A3)', text: '' });
  // Register formulas like the UI does on load.
  store.getCells().forEach(([id, cell]) => {
    const formula = formulaText(cell);
    if (formula !== undefined) engine.setFormula(id, formula, formulaDependencies(formula));
  });
  return { store, engine, unsubscribe: sync.unsubscribe };
}

describe('undo restores formula recalculation (T1.2)', () => {
  it('undo of a sort restores the SUM over the original range', () => {
    const { store, unsubscribe } = setup();
    expect(Number(store.getCell(0, 1)?.text)).toBe(6);

    const cmd = new SortRangeCommand({ r1: 0, c1: 0, r2: 2, c2: 0, sortCol: 0, direction: 'desc' });
    cmd.execute(store);
    expect(Number(store.getCell(0, 1)?.text)).toBe(6); // total unchanged by permutation

    cmd.getUndo().execute(store);
    expect(store.getCell(0, 0)?.text).toBe('3');
    expect(Number(store.getCell(0, 1)?.text)).toBe(6);
    unsubscribe();
  });

  it('undo of SetCellText restores the dependent formula value', () => {
    const { store, unsubscribe } = setup();
    expect(Number(store.getCell(0, 1)?.text)).toBe(6);

    const cmd = new SetCellText({ r: 0, c: 0, text: '10' });
    cmd.execute(store);
    expect(Number(store.getCell(0, 1)?.text)).toBe(13);

    cmd.getUndo().execute(store);
    expect(store.getCell(0, 0)?.text).toBe('3');
    expect(Number(store.getCell(0, 1)?.text)).toBe(6);
    unsubscribe();
  });

  it('undo of a sort keeps a single-row reference formula pointing at restored data', () => {
    const store = new Store();
    const engine = new FormulaEngine(store);
    const sync = createFormulaSync(store, engine);
    store.setCell(0, 0, { text: 'b' });
    store.setCell(1, 0, { text: 'a' });
    store.setCell(0, 1, { text: '10' });
    store.setCell(1, 1, { text: '20' });
    store.setCell(2, 1, { formula: '=B1+B2', text: '' });
    store.getCells().forEach(([id, cell]) => {
      const formula = formulaText(cell);
      if (formula !== undefined) engine.setFormula(id, formula, formulaDependencies(formula));
    });
    expect(Number(store.getCell(2, 1)?.text)).toBe(30);

    const cmd = new SortRangeCommand({ r1: 0, c1: 0, r2: 1, c2: 1, sortCol: 0, direction: 'asc' });
    cmd.execute(store);
    expect(Number(store.getCell(2, 1)?.text)).toBe(30);

    cmd.getUndo().execute(store);
    expect(store.getCell(0, 0)?.text).toBe('b');
    expect(Number(store.getCell(2, 1)?.text)).toBe(30);
    sync.unsubscribe();
  });
});
