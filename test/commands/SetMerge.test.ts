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
});
