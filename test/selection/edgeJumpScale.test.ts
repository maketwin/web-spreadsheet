import { afterEach, describe, expect, it, vi } from 'vitest';
import { Store } from '../../src/store/Store';
import { TOTAL_COLS, TOTAL_ROWS } from '../../src/util/gridSize';
import { edgeJump } from '../../src/selection/currentRegion';

/**
 * Scale guards for Ctrl+arrow: jumping across an empty stretch of the
 * Excel-sized grid must cost the stored cells near the path, not the
 * million addresses in between.
 */

describe('edgeJump at grid scale', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('from A1, Ctrl+Down lands on content a million rows down without scanning', () => {
    const store = new Store();
    store.setCell(999_999, 0, { text: 'deep' });
    const spy = vi.spyOn(Store.prototype, 'getCell');
    const target = edgeJump(store, { r: 0, c: 0 }, 1, 0, TOTAL_ROWS, TOTAL_COLS);
    expect(target).toEqual({ r: 999_999, c: 0 });
    expect(spy.mock.calls.length).toBeLessThanOrEqual(64);
  });

  it('Ctrl+Up from the deep cell returns to A1 without scanning', () => {
    const store = new Store();
    store.setCell(999_999, 0, { text: 'deep' });
    const spy = vi.spyOn(Store.prototype, 'getCell');
    const target = edgeJump(store, { r: 999_999, c: 0 }, -1, 0, TOTAL_ROWS, TOTAL_COLS);
    expect(target).toEqual({ r: 0, c: 0 });
    expect(spy.mock.calls.length).toBeLessThanOrEqual(64);
  });

  it('jumping across a far gap between two runs stays bounded', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'a' });
    store.setCell(999_990, 0, { text: 'b' });
    const spy = vi.spyOn(Store.prototype, 'getCell');
    expect(edgeJump(store, { r: 0, c: 0 }, 1, 0, TOTAL_ROWS, TOTAL_COLS)).toEqual({ r: 999_990, c: 0 });
    expect(spy.mock.calls.length).toBeLessThanOrEqual(64);
  });

  it('with no content below, Ctrl+Down still lands on the grid edge', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'a' });
    const target = edgeJump(store, { r: 0, c: 0 }, 1, 0, TOTAL_ROWS, TOTAL_COLS);
    expect(target).toEqual({ r: TOTAL_ROWS - 1, c: 0 });
  });
});
