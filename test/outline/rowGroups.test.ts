import { describe, expect, it } from 'vitest';
import { Store } from '../../src/store/Store';
import { applyGroupRows, applyUngroupRows, applyCollapseGroup, applyExpandGroup } from '../../src/outline/rowGroups';

describe('row groups (outline)', () => {
  it('groups selected rows and serializes them', () => {
    const store = new Store();
    applyGroupRows(store, 9, 11);
    expect(store.getRowGroups()).toEqual([{ start: 9, end: 11 }]);
    applyGroupRows(store, 14, 16);
    expect(store.getRowGroups().length).toBe(2);
  });

  it('merges overlapping/adjacent groups', () => {
    const store = new Store();
    applyGroupRows(store, 0, 3);
    applyGroupRows(store, 4, 7);
    // 0-3 与 4-7 相邻 → 合并为 0-7
    expect(store.getRowGroups()).toEqual([{ start: 0, end: 7 }]);
  });

  it('collapse hides member rows, expand unhides them', () => {
    const store = new Store();
    store.setCell(9, 0, { text: 'x', value: 'x' });
    applyGroupRows(store, 9, 11);
    applyCollapseGroup(store, 10);
    expect(store.getRow(9)?.hide).toBe(true);
    expect(store.getRow(10)?.hide).toBe(true);
    expect(store.getRow(11)?.hide).toBe(true);
    applyExpandGroup(store, 10);
    expect(store.getRow(9)?.hide).toBe(false);
    expect(store.getRow(10)?.hide).toBe(false);
  });

  it('ungroup removes covering groups only', () => {
    const store = new Store();
    applyGroupRows(store, 0, 3);
    applyGroupRows(store, 10, 12);
    applyUngroupRows(store, 10, 12);
    expect(store.getRowGroups()).toEqual([{ start: 0, end: 3 }]);
  });
});
