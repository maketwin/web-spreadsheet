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

  it('merged 4 cells render as 1 region via getMergeAt', () => {
    const store = new Store();

    new SetMerge({ range: 'A1:B2', active: true }).execute(store);

    // All 4 cells in the merge should return the same range string
    expect(store.getMergeAt(0, 0)).toBe('A1:B2');
    expect(store.getMergeAt(0, 1)).toBe('A1:B2');
    expect(store.getMergeAt(1, 0)).toBe('A1:B2');
    expect(store.getMergeAt(1, 1)).toBe('A1:B2');
    // A cell outside the merge should return undefined
    expect(store.getMergeAt(2, 0)).toBeUndefined();
  });

  it('unmerge removes the merge', () => {
    const store = new Store();

    new SetMerge({ range: 'A1:B2', active: true }).execute(store);
    new SetMerge({ range: 'A1:B2', active: false }).execute(store);

    expect(store.getMerges()).toEqual([]);
    expect(store.getMergeAt(0, 0)).toBeUndefined();
  });

  it('multiple merges can coexist', () => {
    const store = new Store();

    new SetMerge({ range: 'A1:B2', active: true }).execute(store);
    new SetMerge({ range: 'C3:D4', active: true }).execute(store);

    expect(store.getMerges()).toEqual(['A1:B2', 'C3:D4']);
    expect(store.getMergeAt(0, 0)).toBe('A1:B2');
    expect(store.getMergeAt(2, 2)).toBe('C3:D4');
  });
});

describe('SetMerge Excel semantics', () => {
  it('keeps only the anchor value and clears covered cells', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'keep' });
    store.setCell(0, 1, { text: 'drop' });
    store.setCell(1, 0, { text: 'drop2' });

    new SetMerge({ range: 'A1:B2', active: true }).execute(store);

    expect(store.getCell(0, 0)?.text).toBe('keep');
    expect(store.getCell(0, 1)).toBeUndefined();
    expect(store.getCell(1, 0)).toBeUndefined();
  });

  it('undo restores cleared values', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'keep' });
    store.setCell(0, 1, { text: 'drop' });
    const cmd = new SetMerge({ range: 'A1:B2', active: true });

    cmd.execute(store);
    cmd.getUndo().execute(store);

    expect(store.getMerges()).toEqual([]);
    expect(store.getCell(0, 1)?.text).toBe('drop');
  });

  it('replaces an overlapping merge', () => {
    const store = new Store();
    new SetMerge({ range: 'A1:B2', active: true }).execute(store);

    new SetMerge({ range: 'B2:D4', active: true }).execute(store);

    expect(store.getMerges()).toEqual(['B2:D4']);
  });

  it('undo of a replacing merge restores the prior merge', () => {
    const store = new Store();
    new SetMerge({ range: 'A1:B2', active: true }).execute(store);
    const cmd = new SetMerge({ range: 'B2:D4', active: true });

    cmd.execute(store);
    cmd.getUndo().execute(store);

    expect(store.getMerges()).toEqual(['A1:B2']);
  });

  it('unmerge removes every merge intersecting the range', () => {
    const store = new Store();
    new SetMerge({ range: 'A1:B2', active: true }).execute(store);
    new SetMerge({ range: 'C3:D4', active: true }).execute(store);

    new SetMerge({ range: 'A1:D4', active: false }).execute(store);

    expect(store.getMerges()).toEqual([]);
  });

  it('redo re-applies the merge', () => {
    const store = new Store();
    store.setCell(0, 1, { text: 'x' });
    const cmd = new SetMerge({ range: 'A1:B2', active: true });
    cmd.execute(store);
    cmd.getUndo().execute(store);

    cmd.execute(store);

    expect(store.getMerges()).toEqual(['A1:B2']);
    expect(store.getCell(0, 1)).toBeUndefined();
  });
});

import { CommandManager } from '../../src/commands/CommandManager';

describe('SetMerge no-op guards (Excel)', () => {
  it('merging a single cell is a no-op and stays out of history', () => {
    const store = new Store();
    const cm = new CommandManager(store);

    cm.execute(new SetMerge({ range: 'A1:A1', active: true }));

    expect(store.getMerges()).toEqual([]);
    expect(cm.canUndo()).toBe(false);
  });

  it('unmerge where nothing is merged is a no-op and stays out of history', () => {
    const store = new Store();
    const cm = new CommandManager(store);

    cm.execute(new SetMerge({ range: 'B2:C3', active: false }));

    expect(cm.canUndo()).toBe(false);
  });
});
