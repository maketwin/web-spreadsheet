import { describe, expect, it } from 'vitest';
import { isExactlyOneMerge, moveDirection, resolveArrowTarget, snapClickSelection, snapRangeSelection } from '../../src/selection/mergeSnap';
import { cellSelection, extendSelection, rangeSelection } from '../../src/selection/Selection';
import { Store } from '../../src/store/Store';

describe('snapClickSelection (Excel: click selects the whole merge)', () => {
  it('returns a plain cell selection outside merges', () => {
    const store = new Store();
    const sel = snapClickSelection(store, 5, 5);
    expect(sel.range).toEqual({ r1: 5, c1: 5, r2: 5, c2: 5 });
  });

  it('selects the whole merge when clicking any covered cell', () => {
    const store = new Store();
    store.addMerge('B2:D4');
    const sel = snapClickSelection(store, 3, 2); // C4 inside B2:D4
    expect(sel.range).toEqual({ r1: 1, c1: 1, r2: 3, c2: 3 });
    expect(sel.anchor).toEqual({ r: 1, c: 1 });
    expect(sel.active).toEqual({ r: 1, c: 1 });
  });
});

describe('snapRangeSelection (drag/shift edges snap to merges)', () => {
  it('expands a drag that ends inside a merge', () => {
    const store = new Store();
    store.addMerge('C3:E5');
    const sel = snapRangeSelection(store, rangeSelection({ r1: 0, c1: 0, r2: 2, c2: 2 }));
    expect(sel.range).toEqual({ r1: 0, c1: 0, r2: 4, c2: 4 });
  });

  it('snaps the anchor to the merge anchor when the drag starts inside a merge', () => {
    const store = new Store();
    store.addMerge('B2:C2');
    const base = cellSelection(1, 2); // C2 inside the merge
    const sel = snapRangeSelection(store, extendSelection(base, { r: 4, c: 4 }));
    expect(sel.anchor).toEqual({ r: 1, c: 1 });
    expect(sel.range.r1).toBe(1);
    expect(sel.range.c1).toBe(1);
  });
});

describe('resolveArrowTarget (Excel: a merge is one navigation stop)', () => {
  it('stepping into a merge selects it whole', () => {
    const store = new Store();
    store.addMerge('B3:D5');
    const target = resolveArrowTarget(store, { r1: 0, c1: 1, r2: 0, c2: 1 }, { r1: 2, c1: 1, r2: 2, c2: 1 }, 1, 0);
    expect(target).toEqual({ r1: 2, c1: 1, r2: 4, c2: 3 });
  });

  it('stepping down out of a merge lands past its bottom edge', () => {
    const store = new Store();
    store.addMerge('B3:D5');
    const target = resolveArrowTarget(store, { r1: 2, c1: 1, r2: 4, c2: 3 }, { r1: 3, c1: 1, r2: 3, c2: 1 }, 1, 0);
    expect(target).toEqual({ r1: 5, c1: 1, r2: 5, c2: 1 });
  });

  it('stepping up out of a merge lands above its top edge', () => {
    const store = new Store();
    store.addMerge('B3:D5');
    const target = resolveArrowTarget(store, { r1: 2, c1: 1, r2: 4, c2: 3 }, { r1: 1, c1: 1, r2: 1, c2: 1 }, -1, 0);
    expect(target).toEqual({ r1: 1, c1: 1, r2: 1, c2: 1 });
  });

  it('stepping right out of a merge lands past its right edge', () => {
    const store = new Store();
    store.addMerge('B3:D5');
    const target = resolveArrowTarget(store, { r1: 2, c1: 1, r2: 4, c2: 3 }, { r1: 2, c1: 4, r2: 2, c2: 4 }, 0, 1);
    expect(target).toEqual({ r1: 2, c1: 4, r2: 2, c2: 4 });
  });

  it('leaves unmerged targets untouched', () => {
    const store = new Store();
    const target = resolveArrowTarget(store, { r1: 0, c1: 0, r2: 0, c2: 0 }, { r1: 1, c1: 0, r2: 1, c2: 0 }, 1, 0);
    expect(target).toEqual({ r1: 1, c1: 0, r2: 1, c2: 0 });
  });

  it('clamps at the grid top edge', () => {
    const store = new Store();
    store.addMerge('A1:B2');
    const target = resolveArrowTarget(store, { r1: 0, c1: 0, r2: 1, c2: 1 }, { r1: 0, c1: 0, r2: 0, c2: 0 }, -1, 0);
    expect(target.r1).toBe(0);
  });
});

describe('isExactlyOneMerge', () => {
  it('detects a selection that is exactly one merge', () => {
    const store = new Store();
    store.addMerge('B2:D4');
    expect(isExactlyOneMerge(store, { r1: 1, c1: 1, r2: 3, c2: 3 })).toBe(true);
    expect(isExactlyOneMerge(store, { r1: 1, c1: 1, r2: 3, c2: 4 })).toBe(false);
    expect(isExactlyOneMerge(store, { r1: 0, c1: 0, r2: 0, c2: 0 })).toBe(false);
  });
});

describe('moveDirection', () => {
  it('computes the sign of the step', () => {
    expect(moveDirection({ r1: 2, c1: 2, r2: 2, c2: 2 }, { r1: 3, c1: 2, r2: 3, c2: 2 })).toEqual({ dr: 1, dc: 0 });
    expect(moveDirection({ r1: 2, c1: 2, r2: 2, c2: 2 }, { r1: 2, c1: 1, r2: 2, c2: 1 })).toEqual({ dr: 0, dc: -1 });
  });
});
