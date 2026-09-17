import { describe, it, expect } from 'vitest';
import { executeRange } from '../../src/util/rangeValues';
import { CommandManager } from '../../src/commands/CommandManager';
import { Store } from '../../src/store/Store';

describe('SetRangeValues sheet targeting', () => {
  it('writes to the active sheet', () => {
    const store = new Store();
    executeRange(store, undefined, 0, 0, [[{ text: 'A' }]]);
    expect(store.getCell(0, 0, 'sheet-1')?.text).toBe('A');
  });

  it('undo restores to the sheet that was active at execution time, not the current one', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'old' }); // sheet-1
    const second = store.addSheet('Data'); // addSheet activates Data
    const cmd = new CommandManager(store);
    // The write targets the ACTIVE sheet (Data) at execution.
    executeRange(store, cmd, 0, 0, [[{ text: 'new' }]]);
    expect(store.getCell(0, 0, second)?.text).toBe('new');
    // User switches to sheet-1 before undoing — the restore must still hit Data.
    store.activateSheet('sheet-1');
    cmd.undo();
    expect(store.getCell(0, 0, second)?.text).toBeUndefined();
    expect(store.getCell(0, 0, 'sheet-1')?.text).toBe('old');
  });

  it('redo re-applies onto the original sheet after undo and switching', () => {
    const store = new Store();
    store.setCell(2, 2, { text: 'base' }); // sheet-1 (never touched below)
    const second = store.addSheet('Data'); // activates Data; Data(2,2) starts empty
    const cmd = new CommandManager(store);
    executeRange(store, cmd, 2, 2, [[{ text: 'changed' }]]); // targets Data
    store.activateSheet('sheet-1');
    cmd.undo();
    expect(store.getCell(2, 2, second)?.text).toBeUndefined();
    expect(store.getCell(2, 2, 'sheet-1')?.text).toBe('base');
    cmd.redo();
    expect(store.getCell(2, 2, second)?.text).toBe('changed');
    expect(store.getCell(2, 2, 'sheet-1')?.text).toBe('base');
  });
});
