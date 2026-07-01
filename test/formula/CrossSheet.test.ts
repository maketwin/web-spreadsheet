import { describe, expect, it } from 'vitest';
import { FormulaEngine } from '../../src/formula/FormulaEngine';
import { Store } from '../../src/store/Store';

describe('Cross-sheet references', () => {
  it('=Sheet2!A1 resolves to value on Sheet2', () => {
    const store = new Store();
    const sheet2Id = store.addSheet('Sheet2');

    // Set Sheet2!A1 = 42
    store.setCell(0, 0, { text: '42', value: 42 }, sheet2Id);

    // Switch back to Sheet1 and set formula
    store.activateSheet('sheet-1');
    const engine = new FormulaEngine(store);
    engine.setFormula('0,0', '=Sheet2!A1', ['Sheet2:0,0']);

    expect(store.getCell(0, 0)?.value).toBe(42);
  });

  it('=SUM(Sheet2!A1:A5) sums range on Sheet2', () => {
    const store = new Store();
    const sheet2Id = store.addSheet('Sheet2');

    // Set Sheet2!A1:A5 = 1,2,3,4,5
    for (let i = 0; i < 5; i += 1) {
      store.setCell(i, 0, { text: String(i + 1), value: i + 1 }, sheet2Id);
    }

    // Switch back to Sheet1 and set formula
    store.activateSheet('sheet-1');
    const engine = new FormulaEngine(store);
    engine.setFormula('0,0', '=SUM(Sheet2!A1:A5)', ['Sheet2:0,0', 'Sheet2:1,0', 'Sheet2:2,0', 'Sheet2:3,0', 'Sheet2:4,0']);

    expect(store.getCell(0, 0)?.value).toBe(15);
  });

  it('=Sheet1!A1+Sheet2!A1 adds cells from both sheets', () => {
    const store = new Store();
    // Sheet1!A1 = 10 (set before adding Sheet2, so active sheet is sheet-1)
    store.setCell(0, 0, { text: '10', value: 10 });
    const sheet2Id = store.addSheet('Sheet2');
    // Sheet2!A1 = 20
    store.setCell(0, 0, { text: '20', value: 20 }, sheet2Id);

    // Switch back to Sheet1 and set formula at B1
    store.activateSheet('sheet-1');
    const engine = new FormulaEngine(store);
    engine.setFormula('0,1', '=Sheet1!A1+Sheet2!A1', ['0,0', 'Sheet2:0,0']);

    expect(store.getCell(0, 1)?.value).toBe(30);
  });

  it('cross-sheet dependency triggers recalculation', () => {
    const store = new Store();
    const sheet2Id = store.addSheet('Sheet2');

    // Sheet2!A1 = 42
    store.setCell(0, 0, { text: '42', value: 42 }, sheet2Id);

    // Sheet1!A1 = =Sheet2!A1
    store.activateSheet('sheet-1');
    const engine = new FormulaEngine(store);
    engine.setFormula('0,0', '=Sheet2!A1', ['Sheet2:0,0']);
    expect(store.getCell(0, 0)?.value).toBe(42);

    // Change Sheet2!A1 to 99
    store.setCell(0, 0, { text: '99', value: 99 }, sheet2Id);
    engine.onCellChanged('0,0', sheet2Id);

    expect(store.getCell(0, 0)?.value).toBe(99);
  });
});
