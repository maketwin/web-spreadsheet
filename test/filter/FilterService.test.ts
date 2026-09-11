import { describe, it, expect } from 'vitest';
import { Store } from '../../src/store/Store';
import { FilterService } from '../../src/filter/FilterService';
import { CommandManager } from '../../src/commands/CommandManager';
import { SetAutoFilterCriteriaCommand } from '../../src/commands/impl/SetAutoFilterCriteria';

describe('FilterService', () => {
  function setupStore(): Store {
    const store = new Store();
    store.setCell(0, 0, { text: 'Name' });
    store.setCell(0, 1, { text: 'Score' });
    store.setCell(1, 0, { text: 'Alice' });
    store.setCell(1, 1, { text: '85', value: 85 });
    store.setCell(2, 0, { text: 'Bob' });
    store.setCell(2, 1, { text: '92', value: 92 });
    store.setCell(3, 0, { text: 'Charlie' });
    store.setCell(3, 1, { text: '78', value: 78 });
    store.setCell(4, 0, { text: 'Alice' });
    store.setCell(4, 1, { text: '95', value: 95 });
    return store;
  }

  it('getFilterValues returns unique sorted values', () => {
    const store = setupStore();
    const svc = new FilterService(store);
    const values = svc.getFilterValues(1, 0, 4);
    expect(values).toEqual(['Alice', 'Bob', 'Charlie']);
  });

  it('filterColumn hides rows not in allowed values', () => {
    const store = setupStore();
    const svc = new FilterService(store);
    svc.filterColumn(1, 0, 4, ['Alice']);
    expect(store.getRow(1)?.hide).toBe(false);
    expect(store.getRow(2)?.hide).toBe(true);
    expect(store.getRow(3)?.hide).toBe(true);
    expect(store.getRow(4)?.hide).toBe(false);
  });

  it('clearFilter removes hide flags', () => {
    const store = setupStore();
    const svc = new FilterService(store);
    svc.filterColumn(1, 0, 4, ['Alice']);
    expect(store.getRow(2)?.hide).toBe(true);
    svc.clearFilter(1, 4);
    expect(store.getRow(2)?.hide).toBeFalsy();
  });

  it('sortRange sorts ascending by column', () => {
    const store = setupStore();
    const svc = new FilterService(store);
    svc.sortRange(1, 0, 4, 1, 1, 'asc');
    expect(store.getCell(1, 1)?.value).toBe(78);
    expect(store.getCell(2, 1)?.value).toBe(85);
    expect(store.getCell(3, 1)?.value).toBe(92);
    expect(store.getCell(4, 1)?.value).toBe(95);
  });

  it('sortRange sorts descending by column', () => {
    const store = setupStore();
    const svc = new FilterService(store);
    svc.sortRange(1, 0, 4, 1, 1, 'desc');
    expect(store.getCell(1, 1)?.value).toBe(95);
    expect(store.getCell(2, 1)?.value).toBe(92);
    expect(store.getCell(3, 1)?.value).toBe(85);
    expect(store.getCell(4, 1)?.value).toBe(78);
  });

  it('multi-value filter keeps rows matching any value', () => {
    const store = setupStore();
    const svc = new FilterService(store);
    svc.filterColumn(1, 0, 4, ['Alice', 'Bob']);
    expect(store.getRow(1)?.hide).toBe(false);
    expect(store.getRow(2)?.hide).toBe(false);
    expect(store.getRow(3)?.hide).toBe(true);
    expect(store.getRow(4)?.hide).toBe(false);
  });

  it('filter on empty allowed shows nothing hidden if cells empty', () => {
    const store = new Store();
    const svc = new FilterService(store);
    svc.filterColumn(0, 0, 5, ['x']);
    for (let r = 0; r <= 5; r += 1) {
      expect(store.getRow(r)?.hide).toBeFalsy();
    }
  });
});

describe('Excel-like AutoFilter', () => {
  function setupStore(): Store {
    const store = new Store();
    store.setCell(0, 0, { text: 'Name' });
    store.setCell(0, 1, { text: 'Score' });
    store.setCell(1, 0, { text: 'Alice' });
    store.setCell(1, 1, { text: '85', value: 85 });
    store.setCell(2, 0, { text: 'Bob' });
    store.setCell(2, 1, { text: '92', value: 92 });
    store.setCell(3, 0, { text: 'Charlie' });
    store.setCell(3, 1, { text: '78', value: 78 });
    store.setCell(4, 0, { text: 'Alice' });
    store.setCell(4, 1, { text: '95', value: 95 });
    return store;
  }

  it('returns filter checklist items with counts and blanks', () => {
    const store = setupStore();
    store.setCell(5, 0, { text: '' });
    store.setAutoFilter({ range: { r1: 0, c1: 0, r2: 5, c2: 1 }, criteria: {} });
    const svc = new FilterService(store);
    expect(svc.getFilterItems(0)).toEqual([
      { text: 'Alice', blank: false, selected: true, count: 2 },
      { text: 'Bob', blank: false, selected: true, count: 1 },
      { text: 'Charlie', blank: false, selected: true, count: 1 },
      { text: '(空白)', blank: true, selected: true, count: 1 },
    ]);
  });

  it('builds checklist from rows passing other filters but ignores the current filter', () => {
    const store = setupStore();
    const svc = new FilterService(store);
    svc.setAutoFilter({ r1: 0, c1: 0, r2: 4, c2: 1 });
    svc.setColumnFilter(1, { selected: ['85', '92'], includeBlanks: true });
    svc.setColumnFilter(0, { selected: ['Alice'], includeBlanks: true });

    const items = svc.getFilterItems(0);
    expect(items.map((item) => item.text)).toEqual(['Alice', 'Bob']);
    expect(items.find((item) => item.text === 'Alice')?.selected).toBe(true);
    expect(items.find((item) => item.text === 'Bob')?.selected).toBe(false);
  });

  it('combines filters across columns and preserves the header row', () => {
    const store = setupStore();
    const svc = new FilterService(store);
    svc.setAutoFilter({ r1: 0, c1: 0, r2: 4, c2: 1 });
    svc.setColumnFilter(0, { selected: ['Alice'], includeBlanks: true });
    svc.setColumnFilter(1, { selected: ['85', '95'], includeBlanks: true });
    expect(store.getCell(0, 0)?.text).toBe('Name');
    expect(store.getRow(1)?.hide).toBe(false);
    expect(store.getRow(2)?.hide).toBe(true);
    expect(store.getRow(3)?.hide).toBe(true);
    expect(store.getRow(4)?.hide).toBe(false);
  });

  it('clears a column without removing other column criteria', () => {
    const store = setupStore();
    const svc = new FilterService(store);
    svc.setAutoFilter({ r1: 0, c1: 0, r2: 4, c2: 1 });
    svc.setColumnFilter(0, { selected: ['Alice'], includeBlanks: true });
    svc.setColumnFilter(1, { selected: ['85'], includeBlanks: true });
    svc.clearColumnFilter(0);
    expect(svc.hasColumnFilter(0)).toBe(false);
    expect(svc.hasColumnFilter(1)).toBe(true);
    expect(store.getRow(1)?.hide).toBe(false);
    expect(store.getRow(2)?.hide).toBe(true);
    expect(store.getRow(4)?.hide).toBe(true);
  });

  it('sorts the filter data region and leaves the header unchanged', () => {
    const store = setupStore();
    const svc = new FilterService(store);
    svc.setAutoFilter({ r1: 0, c1: 0, r2: 4, c2: 1 });
    svc.sortRange(0, 0, 0, 0, 0, 'asc');
    expect(store.getCell(0, 0)?.text).toBe('Name');
    expect(store.getCell(1, 0)?.text).toBe('Alice');
    expect(store.getCell(2, 0)?.text).toBe('Alice');
    expect(store.getCell(3, 0)?.text).toBe('Bob');
    expect(store.getCell(4, 0)?.text).toBe('Charlie');
  });

  it('keeps blanks last when sorting either direction', () => {
    const store = new Store();
    store.setCell(0, 0, { text: '3' });
    store.setCell(1, 0, { text: '' });
    store.setCell(2, 0, { text: '1' });
    const svc = new FilterService(store);
    svc.sortRange(0, 0, 2, 0, 0, 'asc');
    expect([0, 1, 2].map((r) => store.getCell(r, 0)?.text)).toEqual(['1', '3', '']);
    svc.sortRange(0, 0, 2, 0, 0, 'desc');
    expect([0, 1, 2].map((r) => store.getCell(r, 0)?.text)).toEqual(['3', '1', '']);
  });

  it('supports undo and redo for checklist criteria', () => {
    const store = setupStore();
    const svc = new FilterService(store);
    svc.setAutoFilter({ r1: 0, c1: 0, r2: 4, c2: 1 });
    const commands = new CommandManager(store);
    const command = new SetAutoFilterCriteriaCommand({
      column: 0,
      mode: 'set',
      criteria: { selected: ['Alice'], includeBlanks: true },
    });
    commands.execute(command);
    expect(store.getRow(2)?.hide).toBe(true);
    commands.undo();
    expect(store.getRow(2)?.hide).toBeFalsy();
    commands.redo();
    expect(store.getRow(2)?.hide).toBe(true);
  });

  it('serializes and restores AutoFilter state', () => {
    const store = setupStore();
    const svc = new FilterService(store);
    svc.setAutoFilter({ r1: 0, c1: 0, r2: 4, c2: 1 });
    svc.setColumnFilter(0, { selected: ['Alice'], includeBlanks: true });
    const restored = Store.deserialize(store.serialize());
    expect(restored.getAutoFilter()).toEqual(store.getAutoFilter());
  });
});

describe('FilterService custom conditions', () => {
  function setupStore(): Store {
    const store = new Store();
    store.setCell(0, 0, { text: 'Name' });
    store.setCell(0, 1, { text: 'Score' });
    store.setCell(1, 0, { text: 'Alice' });
    store.setCell(1, 1, { text: '85', value: 85 });
    store.setCell(2, 0, { text: 'Bob' });
    store.setCell(2, 1, { text: '92', value: 92 });
    store.setCell(3, 0, { text: 'Charlie' });
    store.setCell(3, 1, { text: '78', value: 78 });
    store.setCell(4, 0, { text: 'alice' });
    store.setCell(4, 1, { text: '95', value: 95 });
    store.setCell(5, 0, { text: '' });
    const service = new FilterService(store);
    service.setAutoFilter({ r1: 0, c1: 0, r2: 5, c2: 1 });
    return store;
  }

  const hiddenRows = (store: Store): number[] =>
    [1, 2, 3, 4, 5].filter((r) => store.getRow(r)?.hide === true);

  it('numeric gt compares as numbers', () => {
    const store = setupStore();
    const svc = new FilterService(store);
    svc.setColumnFilter(1, { selected: [], includeBlanks: false, conditions: [{ operator: 'gt', value: '85' }] });
    expect(hiddenRows(store)).toEqual([1, 3, 5]); // blanks hidden under conditions
  });

  it('between keeps the inclusive range', () => {
    const store = setupStore();
    const svc = new FilterService(store);
    svc.setColumnFilter(1, {
      selected: [],
      includeBlanks: false,
      conditions: [{ operator: 'between', value: '80', value2: '95' }],
    });
    expect(hiddenRows(store)).toEqual([3, 5]); // blanks hidden under conditions
  });

  it('contains is case-insensitive and hides blanks', () => {
    const store = setupStore();
    const svc = new FilterService(store);
    svc.setColumnFilter(0, { selected: [], includeBlanks: true, conditions: [{ operator: 'contains', value: 'ALIC' }] });
    expect(hiddenRows(store)).toEqual([2, 3, 5]);
  });

  it('two conditions combine with or', () => {
    const store = setupStore();
    const svc = new FilterService(store);
    svc.setColumnFilter(0, {
      selected: [],
      includeBlanks: false,
      conditions: [{ operator: 'beginsWith', value: 'b' }, { operator: 'endsWith', value: 'e' }],
      conditionsOp: 'or',
    });
    // Bob begins with b; Alice/alice/Charlie end with e.
    expect(hiddenRows(store)).toEqual([5]);
  });

  it('two conditions combine with and by default', () => {
    const store = setupStore();
    const svc = new FilterService(store);
    svc.setColumnFilter(0, {
      selected: [],
      includeBlanks: false,
      conditions: [{ operator: 'contains', value: 'a' }, { operator: 'contains', value: 'b' }],
    });
    // Only "Bob" contains both a? No: Bob has no 'a'. None match both... 'Alice' has a but no b.
    expect(hiddenRows(store)).toEqual([1, 2, 3, 4, 5]);
  });

  it('checklist items mirror active conditions', () => {
    const store = setupStore();
    const svc = new FilterService(store);
    svc.setColumnFilter(0, { selected: [], includeBlanks: false, conditions: [{ operator: 'contains', value: 'ali' }] });
    const items = svc.getFilterItems(0);
    const selected = new Map(items.map((item) => [item.text, item.selected]));
    expect(selected.get('Alice')).toBe(true);
    expect(selected.get('alice')).toBe(true);
    expect(selected.get('Bob')).toBe(false);
    expect(selected.get('Charlie')).toBe(false);
    expect(selected.get('(空白)')).toBe(false);
  });

  it('confirming a checklist selection clears conditions on next apply', () => {
    const store = setupStore();
    const svc = new FilterService(store);
    svc.setColumnFilter(0, { selected: [], includeBlanks: false, conditions: [{ operator: 'contains', value: 'ali' }] });
    svc.setColumnFilter(0, { selected: ['Bob'], includeBlanks: false });
    expect(hiddenRows(store)).toEqual([1, 3, 4, 5]);
  });
});
