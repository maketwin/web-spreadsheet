import { describe, expect, it } from 'vitest';
import { Store } from '../../src/store/Store';
import { FormulaEngine } from '../../src/formula/FormulaEngine';
import { createFormulaSync } from '../../src/components/Spreadsheet';
import { formulaDependencies, formulaText, remapFormulaRows } from '../../src/util/cell';
import { FilterService } from '../../src/filter/FilterService';
import { SortRangeCommand } from '../../src/commands/impl/SortRange';
import { CommandManager } from '../../src/commands/CommandManager';

function setupDemoLike() {
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
  return store;
}

function wireEngine(store: Store) {
  const engine = new FormulaEngine(store);
  const sync = createFormulaSync(store, engine);
  store.getCells().forEach(([id, cell]) => {
    const formula = formulaText(cell);
    if (formula !== undefined) engine.setFormula(id, formula, formulaDependencies(formula));
  });
  return { engine, sync };
}

describe('filter then sort formulas', () => {
  it('maps every row in a range so interior moves cannot shrink the span', () => {
    // Rows 1,2,3 → 3,4,2 (interior 2 goes past both remapped corners).
    const perm = new Map([[1, 3], [2, 4], [3, 2]]);
    expect(remapFormulaRows('=SUM(F2:F4)', perm, 0, 5)).toBe('=SUM(F3:F5)');
  });

  it('AutoFilter on + sort by formula column keeps 合计 covering all products', () => {
    const store = setupDemoLike();
    const { sync } = wireEngine(store);
    new FilterService(store).setAutoFilter({ r1: 0, c1: 0, r2: 4, c2: 5 });
    new CommandManager(store).execute(
      new SortRangeCommand({ r1: 1, c1: 0, r2: 4, c2: 5, sortCol: 5, direction: 'desc' }),
    );

    expect(store.getCell(1, 0)?.text).toBe('合计');
    expect(store.getCell(1, 5)?.formula).toBe('=SUM(F3:F5)');
    expect(Number(store.getCell(1, 5)?.text)).toBe(1850);
    expect(Number(store.getCell(2, 5)?.text)).toBe(890);
    expect(Number(store.getCell(3, 5)?.text)).toBe(550);
    expect(Number(store.getCell(4, 5)?.text)).toBe(410);
    sync.unsubscribe();
  });

  it('hide a product then sort desc keeps 合计 summing remaining + pinned rows', () => {
    const store = setupDemoLike();
    const { sync } = wireEngine(store);
    const svc = new FilterService(store);
    svc.setAutoFilter({ r1: 0, c1: 0, r2: 4, c2: 5 });
    svc.setColumnFilter(0, { selected: ['产品A', '产品C', '合计'], includeBlanks: false });
    new CommandManager(store).execute(
      new SortRangeCommand({ r1: 1, c1: 0, r2: 4, c2: 5, sortCol: 0, direction: 'desc' }),
    );

    const total = store.getCell(1, 0)?.text === '合计' ? store.getCell(1, 5) : store.getCell(4, 5);
    // 合计 still spans the three original product rows (pinned hidden included).
    expect(total?.formula).toMatch(/^=SUM\(F\d+:F\d+\)$/);
    expect(Number(total?.text)).toBe(1850);
    sync.unsubscribe();
  });
});
