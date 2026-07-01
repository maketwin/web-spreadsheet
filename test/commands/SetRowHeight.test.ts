import { describe, expect, it } from 'vitest';
import { SetRowHeight } from '../../src/commands/impl/SetRowHeight';
import { Store } from '../../src/store/Store';

describe('SetRowHeight', () => {
  it('sets row height', () => {
    const store = new Store();

    new SetRowHeight({ r: 1, height: 32 }).execute(store);

    expect(store.getRow(1)).toEqual({ height: 32 });
  });

  it('undo restores row meta', () => {
    const store = new Store();
    store.setRow(1, { height: 24, hide: true });
    const cmd = new SetRowHeight({ r: 1, height: 32 });

    cmd.execute(store);
    cmd.getUndo().execute(store);

    expect(store.getRow(1)).toEqual({ height: 24, hide: true });
  });
});
