import { describe, expect, it } from 'vitest';
import { SetMergeAcross } from '../../src/commands/impl/SetMerge';
import { Store } from '../../src/store/Store';

describe('SetMergeAcross (Excel Merge Across)', () => {
  it('merges each row of the selection independently', () => {
    const store = new Store();

    new SetMergeAcross({ range: 'A1:C3' }).execute(store);

    expect(store.getMerges()).toEqual(['A1:C1', 'A2:C2', 'A3:C3']);
  });

  it('keeps each row anchor value, clears the rest', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'r1' });
    store.setCell(0, 1, { text: 'x' });
    store.setCell(1, 0, { text: 'r2' });

    new SetMergeAcross({ range: 'A1:C2' }).execute(store);

    expect(store.getCell(0, 0)?.text).toBe('r1');
    expect(store.getCell(0, 1)).toBeUndefined();
    expect(store.getCell(1, 0)?.text).toBe('r2');
  });

  it('undo restores values and removes all row merges', () => {
    const store = new Store();
    store.setCell(0, 1, { text: 'x' });
    const cmd = new SetMergeAcross({ range: 'A1:C2' });

    cmd.execute(store);
    cmd.getUndo().execute(store);

    expect(store.getMerges()).toEqual([]);
    expect(store.getCell(0, 1)?.text).toBe('x');
  });

  it('skips single-column rows', () => {
    const store = new Store();

    new SetMergeAcross({ range: 'A1:A3' }).execute(store);

    expect(store.getMerges()).toEqual([]);
  });
});
