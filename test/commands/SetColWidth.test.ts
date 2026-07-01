import { describe, expect, it } from 'vitest';
import { SetColWidth } from '../../src/commands/impl/SetColWidth';
import { Store } from '../../src/store/Store';

describe('SetColWidth', () => {
  it('sets col width', () => {
    const store = new Store();

    new SetColWidth({ c: 1, width: 120 }).execute(store);

    expect(store.getCol(1)).toEqual({ width: 120 });
  });

  it('undo restores col meta', () => {
    const store = new Store();
    store.setCol(1, { width: 80, hide: true });
    const cmd = new SetColWidth({ c: 1, width: 120 });

    cmd.execute(store);
    cmd.getUndo().execute(store);

    expect(store.getCol(1)).toEqual({ width: 80, hide: true });
  });
});
