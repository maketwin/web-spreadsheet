import { describe, it, expect } from 'vitest';
import { Store } from '../../src/store/Store';
import { FilterService } from '../../src/filter/FilterService';

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
