import { describe, expect, it } from 'vitest';
import { DeleteRowCommand } from '../../src/commands/impl/DeleteRow';
import { Store } from '../../src/store/Store';

describe('DeleteRowCommand', () => {
  it('deletes a row and shifts lower rows up', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'A1' });
    store.setCell(1, 0, { text: 'A2' });
    store.setCell(2, 0, { text: 'A3' });

    new DeleteRowCommand({ r: 1 }).execute(store);

    expect(store.getCell(0, 0)?.text).toBe('A1');
    expect(store.getCell(1, 0)?.text).toBe('A3');
    expect(store.getCell(2, 0)).toBeUndefined();
  });

  it('undo restores deleted row', () => {
    const store = new Store();
    store.setCell(1, 0, { text: 'A2' });
    store.setCell(2, 0, { text: 'A3' });
    const cmd = new DeleteRowCommand({ r: 1 });

    cmd.execute(store);
    cmd.getUndo().execute(store);

    expect(store.getCell(1, 0)?.text).toBe('A2');
    expect(store.getCell(2, 0)?.text).toBe('A3');
  });
});
