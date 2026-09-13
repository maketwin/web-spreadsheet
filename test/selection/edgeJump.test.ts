import { describe, expect, it } from 'vitest';
import { edgeJump } from '../../src/selection/currentRegion';
import { Store } from '../../src/store/Store';

const ROWS = 1000;
const COLS = 26;

/** Column A: rows 2..5 (0-based 1..4) hold a run, a gap, then row 8 (0-based 7). */
function setup(): Store {
  const store = new Store();
  for (let r = 1; r <= 4; r += 1) store.setCell(r, 0, { text: `v${r}` });
  store.setCell(7, 0, { text: 'next-run' });
  return store;
}

describe('edgeJump (Excel Ctrl+arrow)', () => {
  it('from inside a run, jumps to the run\'s last cell', () => {
    const store = setup();
    expect(edgeJump(store, { r: 2, c: 0 }, 1, 0, ROWS, COLS)).toEqual({ r: 4, c: 0 });
    expect(edgeJump(store, { r: 3, c: 0 }, -1, 0, ROWS, COLS)).toEqual({ r: 1, c: 0 });
  });

  it('from a run edge, jumps to the next run\'s first cell', () => {
    const store = setup();
    expect(edgeJump(store, { r: 4, c: 0 }, 1, 0, ROWS, COLS)).toEqual({ r: 7, c: 0 });
    expect(edgeJump(store, { r: 7, c: 0 }, -1, 0, ROWS, COLS)).toEqual({ r: 4, c: 0 });
  });

  it('from an empty cell, jumps to the first content cell in that direction', () => {
    const store = setup();
    expect(edgeJump(store, { r: 0, c: 0 }, 1, 0, ROWS, COLS)).toEqual({ r: 1, c: 0 });
    expect(edgeJump(store, { r: 5, c: 0 }, 1, 0, ROWS, COLS)).toEqual({ r: 7, c: 0 });
  });

  it('with no content in that direction, lands on the grid edge', () => {
    const store = setup();
    expect(edgeJump(store, { r: 7, c: 0 }, 1, 0, ROWS, COLS)).toEqual({ r: ROWS - 1, c: 0 });
    expect(edgeJump(store, { r: 1, c: 0 }, -1, 0, ROWS, COLS)).toEqual({ r: 0, c: 0 });
  });

  it('works along columns too', () => {
    const store = setup();
    store.setCell(0, 1, { text: 'b' });
    store.setCell(0, 2, { text: 'c' });
    store.setCell(0, 5, { text: 'f' });
    expect(edgeJump(store, { r: 0, c: 1 }, 0, 1, ROWS, COLS)).toEqual({ r: 0, c: 2 });
    expect(edgeJump(store, { r: 0, c: 2 }, 0, 1, ROWS, COLS)).toEqual({ r: 0, c: 5 });
    expect(edgeJump(store, { r: 0, c: 3 }, 0, -1, ROWS, COLS)).toEqual({ r: 0, c: 2 });
  });
});
