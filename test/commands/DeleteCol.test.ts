import { describe, expect, it } from 'vitest';
import { DeleteColCommand } from '../../src/commands/impl/DeleteCol';
import { Store } from '../../src/store/Store';

describe('DeleteColCommand', () => {
  it('deletes a column and shifts right columns left', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'A1' });
    store.setCell(0, 1, { text: 'B1' });
    store.setCell(0, 2, { text: 'C1' });

    new DeleteColCommand({ c: 1 }).execute(store);

    expect(store.getCell(0, 0)?.text).toBe('A1');
    expect(store.getCell(0, 1)?.text).toBe('C1');
    expect(store.getCell(0, 2)).toBeUndefined();
  });

  it('undo restores deleted column', () => {
    const store = new Store();
    store.setCell(0, 1, { text: 'B1' });
    store.setCell(0, 2, { text: 'C1' });
    const cmd = new DeleteColCommand({ c: 1 });

    cmd.execute(store);
    cmd.getUndo().execute(store);

    expect(store.getCell(0, 1)?.text).toBe('B1');
    expect(store.getCell(0, 2)?.text).toBe('C1');
  });
});
