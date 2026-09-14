import { describe, expect, it } from 'vitest';
import { Store } from '../../src/store/Store';
import { FormulaEngine } from '../../src/formula/FormulaEngine';
import { createFormulaSync } from '../../src/components/Spreadsheet';
import { formulaDependencies, formulaText } from '../../src/util/cell';
import { FilterService } from '../../src/filter/FilterService';
import { SortRangeCommand } from '../../src/commands/impl/SortRange';
import { CommandManager } from '../../src/commands/CommandManager';
import { SetCellText } from '../../src/commands/impl/SetCellText';

function setup() {
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

describe('edit after filter+sort', () => {
  it('column total updates when a data cell changes after sort by Q3 then restore', () => {
    const { store, sync, mgr } = setup();
    new FilterService(store).setAutoFilter({ r1: 0, c1: 0, r2: 4, c2: 5 });
    mgr.execute(new SortRangeCommand({ r1: 1, c1: 0, r2: 4, c2: 5, sortCol: 3, direction: 'desc' }));
    mgr.execute(new SortRangeCommand({ r1: 1, c1: 0, r2: 4, c2: 5, sortCol: 0, direction: 'asc' }));

    expect(store.getCell(4, 3)?.formula).toBe('=SUM(D2:D4)');
    expect(Number(store.getCell(4, 3)?.text)).toBe(490);

    mgr.execute(new SetCellText({ r: 2, c: 3, text: '4900' }));

    expect(store.getCell(2, 3)?.text).toBe('4900');
    expect(Number(store.getCell(2, 5)?.text)).toBe(5200);
    expect(store.getCell(4, 3)?.formula).toBe('=SUM(D2:D4)');
    expect(Number(store.getCell(4, 3)?.text)).toBe(5280);
    expect(Number(store.getCell(4, 5)?.text)).toBe(6640);
    sync.unsubscribe();
  });

  it('after sort by Q3 desc, 合计 on top must not leave a data cell looking like a broken total', () => {
    const { store, sync, mgr } = setup();
    new FilterService(store).setAutoFilter({ r1: 0, c1: 0, r2: 4, c2: 5 });
    mgr.execute(new SortRangeCommand({ r1: 1, c1: 0, r2: 4, c2: 5, sortCol: 3, direction: 'desc' }));

    // 合计 floats to top with a formula; bottom row is 产品B value 110 — not a total.
    expect(store.getCell(1, 0)?.text).toBe('合计');
    expect(store.getCell(1, 3)?.formula).toMatch(/^=SUM\(/);
    expect(Number(store.getCell(1, 3)?.text)).toBe(490);
    expect(store.getCell(4, 0)?.text).toBe('产品B');
    expect(store.getCell(4, 3)?.formula).toBeUndefined();
    expect(Number(store.getCell(4, 3)?.text)).toBe(110);
    sync.unsubscribe();
  });
});
