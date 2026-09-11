import { describe, it, expect } from 'vitest';
import { Store } from '../../src/store/Store';
import { FilterService } from '../../src/filter/FilterService';
import { sortRowsInPlace } from '../../src/filter/sortRows';
import { SortRangeCommand } from '../../src/commands/impl/SortRange';
import { CommandManager } from '../../src/commands/CommandManager';
import { FormulaEngine } from '../../src/formula/FormulaEngine';
import { createFormulaSync } from '../../src/components/Spreadsheet';
import { cellId, formulaDependencies, formulaText } from '../../src/util/cell';

describe('Excel CurrentRegion inference', () => {
  it('infers a data block that does not start at A1', () => {
    const store = new Store();
    // Header row at B3, data through D6 (0-based r2..r5, c1..c3).
    const block = [['姓名', '部门', '工资'], ['张三', '销售', '5000'], ['李四', '研发', '8000'], ['王五', '销售', '6000']];
    block.forEach((row, i) => row.forEach((text, j) => store.setCell(2 + i, 1 + j, { text })));
    const svc = new FilterService(store);
    // Selecting C4 inside the block must expand to the whole block, like Excel.
    expect(svc.inferDataRegion({ r1: 3, c1: 2, r2: 3, c2: 2 })).toEqual({ r1: 2, c1: 1, r2: 5, c2: 3 });
  });

  it('stops at a fully blank row', () => {
    const store = new Store();
    for (let c = 0; c < 2; c += 1) {
      store.setCell(0, c, { text: `h${c}` });
      store.setCell(1, c, { text: 'a' });
      store.setCell(2, c, { text: 'b' });
      store.setCell(4, c, { text: 'other block' }); // row 3 is blank
    }
    const svc = new FilterService(store);
    expect(svc.inferDataRegion({ r1: 1, c1: 0, r2: 1, c2: 0 })).toEqual({ r1: 0, c1: 0, r2: 2, c2: 1 });
  });

  it('stops at a fully blank column', () => {
    const store = new Store();
    for (let r = 0; r < 3; r += 1) {
      store.setCell(r, 0, { text: `a${r}` });
      store.setCell(r, 1, { text: `b${r}` });
      store.setCell(r, 3, { text: `d${r}` }); // column 2 is blank
    }
    const svc = new FilterService(store);
    expect(svc.inferDataRegion({ r1: 1, c1: 1, r2: 1, c2: 1 })).toEqual({ r1: 0, c1: 0, r2: 2, c2: 1 });
  });

  it('treats empty-text cells as blank for expansion', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'header' });
    store.setCell(1, 0, { text: 'data' });
    store.setCell(2, 0, { text: '' }); // formatted-but-empty cell
    const svc = new FilterService(store);
    expect(svc.inferDataRegion({ r1: 1, c1: 0, r2: 1, c2: 0 })).toEqual({ r1: 0, c1: 0, r2: 1, c2: 0 });
  });
});

describe('sort with formulas', () => {
  function setupSheet(): Store {
    const store = new Store();
    const header = ['产品', 'Q1', 'Q2', 'Q3', 'Q4', '总计'];
    header.forEach((text, c) => store.setCell(0, c, { text }));
    const rows = [
      ['产品A', '100', '120', '150', '180'],
      ['产品B', '80', '90', '110', '130'],
      ['产品C', '200', '210', '230', '250'],
    ];
    rows.forEach((values, i) => {
      values.forEach((text, c) => store.setCell(1 + i, c, { text }));
      store.setCell(1 + i, 5, { formula: `=SUM(B${2 + i}:E${2 + i})`, text: '' });
    });
    for (let c = 1; c <= 5; c += 1) store.setCell(4, c, { formula: `=SUM(${String.fromCharCode(65 + c)}2:${String.fromCharCode(65 + c)}4)`, text: '' });
    store.setCell(4, 0, { text: '合计' });
    return store;
  }

  it('remaps row references through the sort permutation', () => {
    const store = setupSheet();
    sortRowsInPlace(store, 1, 0, 4, 5, 0, 'desc');
    // Descending: 合计, 产品C, 产品B, 产品A land on rows 1..4 (0-based).
    expect([1, 2, 3, 4].map((r) => store.getCell(r, 0)?.text)).toEqual(['合计', '产品C', '产品B', '产品A']);
    expect(store.getCell(1, 1)?.formula).toBe('=SUM(B3:B5)');
    expect(store.getCell(1, 5)?.formula).toBe('=SUM(F3:F5)');
    expect(store.getCell(2, 5)?.formula).toBe('=SUM(B3:E3)'); // 产品C row total follows its row
    expect(store.getCell(3, 5)?.formula).toBe('=SUM(B4:E4)');
    expect(store.getCell(4, 5)?.formula).toBe('=SUM(B5:E5)');
  });

  it('leaves cross-sheet references untouched', () => {
    const store = setupSheet();
    store.setCell(1, 5, { formula: '=Sheet2!B2+F2', text: '' });
    sortRowsInPlace(store, 1, 0, 4, 5, 0, 'desc');
    // The moved cell (now at row 4) keeps the cross-sheet part; F2 follows 产品A's row to row 5.
    expect(store.getCell(4, 5)?.formula).toBe('=Sheet2!B2+F5');
  });

  it('recalculates to correct totals when the engine is wired like the UI', () => {
    const store = setupSheet();
    const engine = new FormulaEngine(store);
    const sync = createFormulaSync(store, engine);
    store.getCells().forEach(([id, cell]) => {
      const formula = formulaText(cell);
      if (formula !== undefined) engine.setFormula(id, formula, formulaDependencies(formula));
    });

    sortRowsInPlace(store, 1, 0, 4, 5, 0, 'desc');

    expect(Number(store.getCell(1, 5)?.text)).toBe(1850); // 合计 = 550 + 410 + 890
    expect(Number(store.getCell(2, 5)?.text)).toBe(890); // 产品C
    expect(Number(store.getCell(3, 5)?.text)).toBe(410); // 产品B
    expect(Number(store.getCell(4, 5)?.text)).toBe(550); // 产品A
    expect(Number(store.getCell(1, 1)?.text)).toBe(380); // Q1 合计 = 200 + 80 + 100
    expect(cellId(1, 1)).toBe('1,1');
    sync.unsubscribe();
  });

  it('delivers batched events only after the sort finished', () => {
    const store = setupSheet();
    const formulasAtFirstEvent: string[] = [];
    let first = true;
    store.subscribe((event) => {
      if (event.type !== 'cell' || !first) return;
      first = false;
      formulasAtFirstEvent.push(...[1, 2, 3, 4].map((r) => store.getCell(r, 5)?.formula ?? ''));
    });
    sortRowsInPlace(store, 1, 0, 4, 5, 0, 'desc');
    expect(formulasAtFirstEvent).toEqual(['=SUM(F3:F5)', '=SUM(B3:E3)', '=SUM(B4:E4)', '=SUM(B5:E5)']);
  });

  it('undoes and redoes the sort with formulas intact', () => {
    const store = setupSheet();
    const manager = new CommandManager(store);
    manager.execute(new SortRangeCommand({ r1: 1, c1: 0, r2: 4, c2: 5, sortCol: 0, direction: 'desc' }));
    manager.undo();
    expect([1, 2, 3, 4].map((r) => store.getCell(r, 0)?.text)).toEqual(['产品A', '产品B', '产品C', '合计']);
    expect(store.getCell(1, 5)?.formula).toBe('=SUM(B2:E2)');
    expect(store.getCell(4, 1)?.formula).toBe('=SUM(B2:B4)');
    manager.redo();
    expect(store.getCell(1, 0)?.text).toBe('合计');
    expect(store.getCell(1, 5)?.formula).toBe('=SUM(F3:F5)');
  });
});

describe('store batch', () => {
  it('coalesces events per cell and defers delivery', () => {
    const store = new Store();
    const events: string[] = [];
    store.subscribe((event) => { if (event.type === 'cell') events.push(`${event.r},${event.c}:${event.cell?.text ?? ''}`); });
    store.batch(() => {
      store.setCell(0, 0, { text: 'a' });
      store.setCell(0, 0, { text: 'b' });
      expect(events).toEqual([]); // nothing delivered mid-batch
    });
    expect(events).toEqual(['0,0:b']); // last write wins
  });

  it('flushes on exception', () => {
    const store = new Store();
    const events: string[] = [];
    store.subscribe((event) => { if (event.type === 'cell') events.push(`${event.r},${event.c}`); });
    expect(() => store.batch(() => {
      store.setCell(0, 0, { text: 'a' });
      throw new Error('boom');
    })).toThrow('boom');
    expect(events).toEqual(['0,0']);
    expect(store.getCell(0, 0)?.text).toBe('a');
  });
});

describe('AutoFilter range for selections', () => {
  const MAX_ROWS = 1000; // renderer grid: TOTAL_ROWS = 1000

  function setupBlock(): Store {
    const store = new Store();
    const block = [['姓名', '部门', '工资'], ['张三', '销售', '5000'], ['李四', '研发', '8000'], ['王五', '销售', '6000']];
    block.forEach((row, i) => row.forEach((text, j) => store.setCell(i, j, { text })));
    return store;
  }

  it('an entire-column selection filters only the selected column', () => {
    const svc = new FilterService(setupBlock());
    // Select column B by clicking its letter header (spans the whole column).
    expect(svc.autoFilterRangeFor({ r1: 0, c1: 1, r2: MAX_ROWS - 1, c2: 1 })).toEqual({ r1: 0, c1: 1, r2: 3, c2: 1 });
  });

  it('a multi-column header selection filters only those columns', () => {
    const svc = new FilterService(setupBlock());
    expect(svc.autoFilterRangeFor({ r1: 0, c1: 1, r2: MAX_ROWS - 1, c2: 2 })).toEqual({ r1: 0, c1: 1, r2: 3, c2: 2 });
  });

  it('an entire-column selection of an empty column falls back to a single header cell', () => {
    const store = setupBlock();
    const svc = new FilterService(store);
    expect(svc.autoFilterRangeFor({ r1: 0, c1: 9, r2: MAX_ROWS - 1, c2: 9 })).toEqual({ r1: 0, c1: 9, r2: 0, c2: 9 });
  });

  it('a partial multi-cell selection filters exactly that range', () => {
    const svc = new FilterService(setupBlock());
    expect(svc.autoFilterRangeFor({ r1: 0, c1: 1, r2: 2, c2: 2 })).toEqual({ r1: 0, c1: 1, r2: 2, c2: 2 });
  });

  it('a single cell filters the current region', () => {
    const svc = new FilterService(setupBlock());
    expect(svc.autoFilterRangeFor({ r1: 2, c1: 1, r2: 2, c2: 1 })).toEqual({ r1: 0, c1: 0, r2: 3, c2: 2 });
  });

  it('no selection filters the region at A1', () => {
    const svc = new FilterService(setupBlock());
    expect(svc.autoFilterRangeFor(null)).toEqual({ r1: 0, c1: 0, r2: 3, c2: 2 });
  });
});

describe('display-value and case-insensitive filtering', () => {
  it('lists formatted values for percent cells', () => {
    const store = new Store();
    store.setCell(0, 0, { text: '完成率' });
    store.setStyle('pct', { numberFormat: 'percent' });
    store.setCell(1, 0, { text: '0.5', value: 0.5, styleId: 'pct' });
    store.setCell(2, 0, { text: '0.75', value: 0.75, styleId: 'pct' });
    store.setAutoFilter({ range: { r1: 0, c1: 0, r2: 2, c2: 0 }, criteria: {} });
    const svc = new FilterService(store);
    expect(svc.getFilterItems(0).map((item) => item.text)).toEqual(['50.00%', '75.00%']);
    svc.setColumnFilter(0, { selected: ['75.00%'], includeBlanks: false });
    expect(store.getRow(1)?.hide).toBe(true);
    expect(store.getRow(2)?.hide).toBe(false);
  });

  it('matches checklist values case-insensitively like Excel', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'Name' });
    store.setCell(1, 0, { text: 'Apple' });
    store.setCell(2, 0, { text: 'apple' });
    store.setCell(3, 0, { text: 'Banana' });
    store.setAutoFilter({ range: { r1: 0, c1: 0, r2: 3, c2: 0 }, criteria: {} });
    const svc = new FilterService(store);
    svc.setColumnFilter(0, { selected: ['APPLE'], includeBlanks: false });
    expect(store.getRow(1)?.hide).toBe(false);
    expect(store.getRow(2)?.hide).toBe(false);
    expect(store.getRow(3)?.hide).toBe(true);
  });
});
