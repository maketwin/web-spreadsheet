import { describe, expect, it } from 'vitest';
import { CommandManager } from '../../src/commands/CommandManager';
import { SetColsHiddenCommand, SetRowsHiddenCommand } from '../../src/commands/impl/SetHidden';
import { Store } from '../../src/store/Store';

describe('SetRowsHiddenCommand', () => {
  it('hides the row span', () => {
    const store = new Store();
    new SetRowsHiddenCommand({ r1: 1, r2: 3, hidden: true }).execute(store);
    expect(store.getRow(1)?.hide).toBe(true);
    expect(store.getRow(2)?.hide).toBe(true);
    expect(store.getRow(3)?.hide).toBe(true);
    expect(store.getRow(4)?.hide).toBeUndefined();
  });

  it('keeps existing meta (height) while hiding', () => {
    const store = new Store();
    store.setRow(2, { height: 40 });
    new SetRowsHiddenCommand({ r1: 2, r2: 2, hidden: true }).execute(store);
    expect(store.getRow(2)).toEqual({ height: 40, hide: true });
  });

  it('undo restores the previous metas exactly', () => {
    const store = new Store();
    store.setRow(1, { height: 30 });
    const cmd = new SetRowsHiddenCommand({ r1: 1, r2: 2, hidden: true });
    cmd.execute(store);
    cmd.getUndo().execute(store);
    expect(store.getRow(1)).toEqual({ height: 30 });
    expect(store.getRow(2)).toBeUndefined();
  });

  it('unhide clears the flag through the command manager', () => {
    const store = new Store();
    const manager = new CommandManager(store);
    manager.execute(new SetRowsHiddenCommand({ r1: 0, r2: 0, hidden: true }));
    expect(store.getRow(0)?.hide).toBe(true);
    manager.execute(new SetRowsHiddenCommand({ r1: 0, r2: 0, hidden: false }));
    expect(store.getRow(0)?.hide).toBe(false);
    manager.undo();
    expect(store.getRow(0)?.hide).toBe(true);
  });
});

describe('SetColsHiddenCommand', () => {
  it('hides and unhides the column span with undo', () => {
    const store = new Store();
    const cmd = new SetColsHiddenCommand({ c1: 0, c2: 1, hidden: true });
    cmd.execute(store);
    expect(store.getCol(0)?.hide).toBe(true);
    expect(store.getCol(1)?.hide).toBe(true);
    cmd.getUndo().execute(store);
    expect(store.getCol(0)).toBeUndefined();
    expect(store.getCol(1)).toBeUndefined();
  });

  it('preserves column width while hiding', () => {
    const store = new Store();
    store.setCol(1, { width: 120 });
    new SetColsHiddenCommand({ c1: 1, c2: 1, hidden: true }).execute(store);
    expect(store.getCol(1)).toEqual({ width: 120, hide: true });
  });
});
