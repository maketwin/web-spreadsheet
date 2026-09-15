import { describe, expect, it } from 'vitest';
import { mergeSelection } from '../../src/components/mergeActions';
import { repeatOnRange } from '../../src/commands/repeat';
import { CommandManager } from '../../src/commands/CommandManager';
import { Store } from '../../src/store/Store';

const alignOf = (store: Store, r: number, c: number): string | undefined => {
  const styleId = store.getCell(r, c)?.styleId;
  return styleId === undefined ? undefined : store.getStyle(styleId)?.align;
};

describe('mergeSelection (Excel Merge & Center)', () => {
  it('Merge & Center is a single undo step restoring merge and alignment', () => {
    const store = new Store();
    const cmdManager = new CommandManager(store);
    store.setCell(0, 0, { text: '80' }); // anchor-only value -> no conflict modal

    mergeSelection(store, cmdManager, { r1: 0, c1: 0, r2: 1, c2: 1 }, 'center');

    expect(store.getMerges()).toEqual(['A1:B2']);
    expect(alignOf(store, 0, 0)).toBe('center');
    expect(cmdManager.getUndoStack()).toHaveLength(1);

    cmdManager.undo();

    expect(store.getMerges()).toEqual([]);
    expect(alignOf(store, 0, 0)).toBeUndefined();
    expect(store.getCell(0, 0)?.text).toBe('80');
    expect(cmdManager.canUndo()).toBe(false);
  });

  it('redo re-applies merge and center together', () => {
    const store = new Store();
    const cmdManager = new CommandManager(store);

    mergeSelection(store, cmdManager, { r1: 0, c1: 0, r2: 1, c2: 1 }, 'center');
    cmdManager.undo();
    cmdManager.redo();

    expect(store.getMerges()).toEqual(['A1:B2']);
    expect(alignOf(store, 0, 0)).toBe('center');
  });

  it('F4 repeats Merge & Center on a new selection (composite parts retarget)', () => {
    const store = new Store();
    const cmdManager = new CommandManager(store);

    mergeSelection(store, cmdManager, { r1: 0, c1: 0, r2: 1, c2: 1 }, 'center');
    const repeated = repeatOnRange(cmdManager.getLastExecuted()!, { r1: 4, c1: 4, r2: 5, c2: 5 });
    expect(repeated).toBeDefined();
    repeated!.execute(store);

    expect(store.getMerges()).toContain('E5:F6');
    expect(alignOf(store, 4, 4)).toBe('center');
  });
});
