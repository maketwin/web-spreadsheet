import { describe, expect, it } from 'vitest';
import { FormulaEngine } from '../../src/formula/FormulaEngine';
import { Store } from '../../src/store/Store';

describe('FormulaEngine', () => {
  it('setFormula triggers recalculation', () => {
    const store = new Store();
    const engine = new FormulaEngine(store);
    store.setCell(0, 0, { text: '10', value: 10 });
    store.setCell(0, 1, { text: '20', value: 20 });

    engine.setFormula('0,2', '=A1+B1', ['0,0', '0,1']);

    expect(store.getCell(0, 2)?.value).toBe(30);
  });

  it('onCellChanged recalculates affected formulas', () => {
    const store = new Store();
    const engine = new FormulaEngine(store);
    store.setCell(0, 0, { text: '10', value: 10 });
    store.setCell(0, 1, { text: '20', value: 20 });
    engine.setFormula('0,2', '=A1+B1', ['0,0', '0,1']);

    store.setCell(0, 0, { text: '15', value: 15 });
    engine.onCellChanged('0,0');

    expect(store.getCell(0, 2)?.value).toBe(35);
  });

  it('removeFormula clears formula', () => {
    const store = new Store();
    const engine = new FormulaEngine(store);
    store.setCell(0, 0, { text: '10', value: 10 });
    engine.setFormula('0,1', '=A1', ['0,0']);

    engine.removeFormula('0,1');

    // Formula should be gone — no recalculation on cell change
    store.setCell(0, 0, { text: '20', value: 20 });
    engine.onCellChanged('0,0');
    expect(store.getCell(0, 1)?.value).toBe(10);
  });
});
