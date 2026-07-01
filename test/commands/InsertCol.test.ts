import { describe, expect, it } from 'vitest';
import { InsertColCommand } from '../../src/commands/impl/InsertCol';
import { Store } from '../../src/store/Store';

describe('InsertColCommand', () => {
  it('inserts a blank column on the left', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'A1' });
    store.setCell(0, 1, { text: 'B1' });

    new InsertColCommand({ c: 1 }).execute(store);

    expect(store.getCell(0, 0)?.text).toBe('A1');
    expect(store.getCell(0, 1)).toBeUndefined();
    expect(store.getCell(0, 2)?.text).toBe('B1');
  });

  it('undo restores column positions', () => {
    const store = new Store();
    store.setCell(0, 1, { text: 'B1' });
    const cmd = new InsertColCommand({ c: 1 });

    cmd.execute(store);
    cmd.getUndo().execute(store);

    expect(store.getCell(0, 1)?.text).toBe('B1');
    expect(store.getCell(0, 2)).toBeUndefined();
  });
});
