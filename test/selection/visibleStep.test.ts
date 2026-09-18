import { describe, expect, it } from 'vitest';
import { sameRange, skipHiddenCells } from '../../src/selection/visibleStep';
import { Store } from '../../src/store/Store';

const at = (r: number, c: number) => ({ r1: r, c1: c, r2: r, c2: c });

describe('skipHiddenCells (Excel: arrows never land on hidden rows/cols)', () => {
  it('skips hidden rows when moving down/up', () => {
    const store = new Store();
    store.setRow(2, { hide: true });
    store.setRow(3, { hide: true });
    expect(skipHiddenCells(store, at(1, 0), at(2, 0), 1, 0)).toEqual(at(4, 0));
    expect(skipHiddenCells(store, at(4, 0), at(3, 0), -1, 0)).toEqual(at(1, 0));
  });

  it('skips hidden columns when moving right/left', () => {
    const store = new Store();
    store.setCol(1, { hide: true });
    expect(skipHiddenCells(store, at(0, 0), at(0, 1), 0, 1)).toEqual(at(0, 2));
    expect(skipHiddenCells(store, at(0, 2), at(0, 1), 0, -1)).toEqual(at(0, 0));
  });

  it('leaves visible targets untouched and preserves row/col meta besides hide', () => {
    const store = new Store();
    store.setRow(2, { height: 40 });
    expect(skipHiddenCells(store, at(1, 0), at(2, 0), 1, 0)).toEqual(at(2, 0));
  });

  it('stays put when the rest of the grid in that direction is hidden', () => {
    const store = new Store();
    store.setCol(1, { hide: true });
    for (let c = 1; c < 26; c += 1) store.setCol(c, { hide: true });
    expect(skipHiddenCells(store, at(0, 0), at(0, 1), 0, 1)).toEqual(at(0, 0));
  });
});

describe('sameRange', () => {
  it('compares rectangles by value', () => {
    expect(sameRange(at(1, 2), at(1, 2))).toBe(true);
    expect(sameRange(at(1, 2), at(1, 3))).toBe(false);
  });
});
