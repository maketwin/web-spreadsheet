import { describe, expect, it } from 'vitest';
import { Store } from '../../src/store/Store';
import { resolveEditAnchor } from '../../src/selection/mergeSnap';

describe('resolveEditAnchor', () => {
  it('returns the cell itself when not merged', () => {
    const store = new Store();
    expect(resolveEditAnchor(store, 2, 3)).toEqual({ anchor: { r: 2, c: 3 }, merge: undefined });
  });

  it('redirects any cell inside a merge to the anchor', () => {
    const store = new Store();
    store.addMerge('B2:D4');
    expect(resolveEditAnchor(store, 3, 3)).toEqual({
      anchor: { r: 1, c: 1 },
      merge: { r1: 1, c1: 1, r2: 3, c2: 3 },
    });
    expect(resolveEditAnchor(store, 1, 1).anchor).toEqual({ r: 1, c: 1 });
  });
});
