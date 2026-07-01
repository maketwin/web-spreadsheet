import { describe, expect, it } from 'vitest';
import { InsertRowCommand } from '../../src/commands/impl/InsertRow';
import { Store } from '../../src/store/Store';

describe('InsertRowCommand', () => {
  it('inserts a blank row above the target', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'A1' });
    store.setCell(1, 0, { text: 'A2' });

    new InsertRowCommand({ r: 1 }).execute(store);

    expect(store.getCell(0, 0)?.text).toBe('A1');
    expect(store.getCell(1, 0)).toBeUndefined();
    expect(store.getCell(2, 0)?.text).toBe('A2');
  });

  it('undo restores row positions', () => {
    const store = new Store();
    store.setCell(1, 0, { text: 'A2' });
    const cmd = new InsertRowCommand({ r: 1 });

    cmd.execute(store);
    cmd.getUndo().execute(store);

    expect(store.getCell(1, 0)?.text).toBe('A2');
    expect(store.getCell(2, 0)).toBeUndefined();
  });
});
