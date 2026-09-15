import { describe, expect, it } from 'vitest';
import { Store } from '../../src/store/Store';
import { FilterService } from '../../src/filter/FilterService';
import { FormulaEngine } from '../../src/formula/FormulaEngine';
import { createFormulaSync } from '../../src/components/Spreadsheet';
import { formulaDependencies, formulaText } from '../../src/util/cell';
import { SortRangeCommand } from '../../src/commands/impl/SortRange';
import { CommandManager } from '../../src/commands/CommandManager';
import { SetCellText } from '../../src/commands/impl/SetCellText';

function setupDemo() {
  const store = new Store();
  ['产品', 'Q1', 'Q2', 'Q3', 'Q4', '总计'].forEach((t, c) => store.setCell(0, c, { text: t }));
  const rows = [
    ['产品A', '100', '120', '150', '180'],
    ['产品B', '80', '90', '110', '130'],
    ['产品C', '200', '210', '230', '250'],
  ];
  rows.forEach((values, i) => {
    values.forEach((text, c) => store.setCell(1 + i, c, c === 0 ? { text } : { text, value: Number(text) }));
    store.setCell(1 + i, 5, { formula: `=SUM(B${2 + i}:E${2 + i})`, text: '' });
  });
  for (let c = 1; c <= 5; c += 1) {
    const col = String.fromCharCode(65 + c);
    store.setCell(4, c, { formula: `=SUM(${col}2:${col}4)`, text: '' });
  }
  store.setCell(4, 0, { text: '合计' });
  const engine = new FormulaEngine(store);
  const sync = createFormulaSync(store, engine);
  store.getCells().forEach(([id, cell]) => {
    const f = formulaText(cell);
    if (f !== undefined) engine.setFormula(id, f, formulaDependencies(f));
  });
  return { store, sync, mgr: new CommandManager(store) };
}

describe('sort range expansion', () => {
  it('resolveSortRange expands a one-column selection to the data block', () => {
    const { store, sync } = setupDemo();
    const resolved = new FilterService(store).resolveSortRange({ r1: 1, c1: 3, r2: 4, c2: 3, sortCol: 3, direction: 'desc' });
    expect(resolved).toEqual({ r1: 1, c1: 0, r2: 4, c2: 5, sortCol: 3, direction: 'desc' });
    sync.unsubscribe();
  });

  it('SortRangeCommand on column D keeps 合计 formulas on the 合计 row', () => {
    const { store, sync, mgr } = setupDemo();
    new FilterService(store).setAutoFilter({ r1: 0, c1: 0, r2: 4, c2: 5 });
    // Narrow args as if the user selected only D2:D5 — must expand.
    mgr.execute(new SortRangeCommand({ r1: 1, c1: 3, r2: 4, c2: 3, sortCol: 3, direction: 'desc' }));

    expect(store.getCell(1, 0)?.text).toBe('合计');
    expect(store.getCell(1, 3)?.formula).toMatch(/^=SUM\(/);
    expect(Number(store.getCell(1, 3)?.text)).toBe(490);
    expect(store.getCell(4, 0)?.text).toBe('产品B');
    expect(Number(store.getCell(4, 3)?.text)).toBe(110);

    // Restore name order, edit 产品B Q3 — column total must follow.
    mgr.execute(new SortRangeCommand({ r1: 1, c1: 0, r2: 4, c2: 5, sortCol: 0, direction: 'asc' }));
    mgr.execute(new SetCellText({ r: 2, c: 3, text: '4900' }));
    expect(store.getCell(4, 0)?.text).toBe('合计');
    expect(store.getCell(4, 3)?.formula).toBe('=SUM(D2:D4)');
    expect(Number(store.getCell(4, 3)?.text)).toBe(5280);
    expect(Number(store.getCell(4, 5)?.text)).toBe(6640);
    sync.unsubscribe();
  });
});
