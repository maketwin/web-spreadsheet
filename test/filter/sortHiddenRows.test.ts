import { describe, expect, it } from 'vitest';
import { Store } from '../../src/store/Store';
import { sortRowsInPlace } from '../../src/filter/sortRows';

describe('sort with filtered (hidden) rows', () => {
  it('keeps hidden rows in place and sorts only visible rows (Excel)', () => {
    const store = new Store();
    // rows 0..4: values 30, 10, 50, 20, 40
    [30, 10, 50, 20, 40].forEach((v, r) => store.setCell(r, 0, { text: String(v), value: v, type: 'number' }));
    // rows 1 and 3 hidden by filter
    store.setRow(1, { hide: true });
    store.setRow(3, { hide: true });
    sortRowsInPlace(store, 0, 0, 4, 0, 0, 'asc');
    // visible rows 0,2,4 get sorted values 30,40,50; hidden keep 10 and 20
    expect([0, 1, 2, 3, 4].map((r) => store.getCell(r, 0)?.text)).toEqual(['30', '10', '40', '20', '50']);
  });

  it('remaps formulas in hidden rows that reference moved visible rows', () => {
    const store = new Store();
    store.setCell(0, 0, { text: '2', value: 2 });
    store.setCell(1, 0, { text: '1', value: 1 });
    // hidden row 2: formula points at visible row 0
    store.setCell(2, 0, { text: '2', formula: '=A1', value: 2 });
    store.setRow(2, { hide: true });
    sortRowsInPlace(store, 0, 0, 2, 0, 0, 'asc');
    // visible rows swap; hidden row 2 pinned, its ref follows row 0 → A2
    expect(store.getCell(0, 0)?.text).toBe('1');
    expect(store.getCell(1, 0)?.text).toBe('2');
    expect(store.getCell(2, 0)?.formula).toBe('=A2');
  });

  it('formula in a moved row referencing a pinned hidden row keeps its ref', () => {
    const store = new Store();
    store.setCell(0, 0, { text: '2', value: 2 });
    store.setCell(1, 0, { text: '1', value: 1 });
    store.setCell(1, 1, { text: '9', formula: '=A3' }); // points at hidden row 2
    store.setCell(2, 0, { text: '9', value: 9 });
    store.setRow(2, { hide: true });
    sortRowsInPlace(store, 0, 0, 2, 1, 0, 'asc');
    // row 1 moves up to row 0; its ref to pinned row 2 stays =A3
    expect(store.getCell(0, 1)?.formula).toBe('=A3');
  });
});
