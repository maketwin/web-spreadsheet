import { describe, expect, it } from 'vitest';
import { SetMerge } from '../../src/commands/impl/SetMerge';
import { Store } from '../../src/store/Store';

describe('SetMerge', () => {
  it('merges range', () => {
    const store = new Store();

    new SetMerge({ range: 'A1:B2', active: true }).execute(store);

    expect(store.getMerges()).toEqual(['A1:B2']);
  });

  it('undo restores merge state', () => {
    const store = new Store();
    const cmd = new SetMerge({ range: 'A1:B2', active: true });

    cmd.execute(store);
    cmd.getUndo().execute(store);

    expect(store.getMerges()).toEqual([]);
  });

  it('merged 4 cells render as 1 region via getMergeAt', () => {
    const store = new Store();

    new SetMerge({ range: 'A1:B2', active: true }).execute(store);

    // All 4 cells in the merge should return the same range string
    expect(store.getMergeAt(0, 0)).toBe('A1:B2');
    expect(store.getMergeAt(0, 1)).toBe('A1:B2');
    expect(store.getMergeAt(1, 0)).toBe('A1:B2');
    expect(store.getMergeAt(1, 1)).toBe('A1:B2');
    // A cell outside the merge should return undefined
    expect(store.getMergeAt(2, 0)).toBeUndefined();
  });

  it('unmerge removes the merge', () => {
    const store = new Store();

    new SetMerge({ range: 'A1:B2', active: true }).execute(store);
    new SetMerge({ range: 'A1:B2', active: false }).execute(store);

    expect(store.getMerges()).toEqual([]);
    expect(store.getMergeAt(0, 0)).toBeUndefined();
  });

  it('multiple merges can coexist', () => {
    const store = new Store();

    new SetMerge({ range: 'A1:B2', active: true }).execute(store);
    new SetMerge({ range: 'C3:D4', active: true }).execute(store);

    expect(store.getMerges()).toEqual(['A1:B2', 'C3:D4']);
    expect(store.getMergeAt(0, 0)).toBe('A1:B2');
    expect(store.getMergeAt(2, 2)).toBe('C3:D4');
  });
});
