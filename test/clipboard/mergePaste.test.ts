import { describe, expect, it } from 'vitest';
import { planMergePaste, snapshotMerges } from '../../src/clipboard/session';
import { ApplyMergeChanges } from '../../src/commands/impl/SetMerge';
import { Store } from '../../src/store/Store';

describe('snapshotMerges', () => {
  it('captures only merges fully inside the copied range', () => {
    const store = new Store();
    store.addMerge('A1:B1');
    store.addMerge('C1:E3');
    expect(snapshotMerges(store, { r1: 0, c1: 0, r2: 0, c2: 4 })).toEqual([{ r1: 0, c1: 0, r2: 0, c2: 1 }]);
  });
});

describe('planMergePaste (Excel merge paste rules)', () => {
  it('replicates the source merge at the paste anchor', () => {
    const store = new Store();
    const plan = planMergePaste(store, [{ r1: 0, c1: 0, r2: 0, c2: 1 }], { r1: 0, c1: 0, r2: 0, c2: 1 }, 4, 4);
    expect(plan.ok).toBe(true);
    expect(plan.add).toEqual(['E5:F5']);
    expect(plan.rect).toEqual({ r1: 4, c1: 4, r2: 4, c2: 5 });
  });

  it('tiles merges for exact-multiple targets', () => {
    const store = new Store();
    const plan = planMergePaste(store, [{ r1: 0, c1: 0, r2: 0, c2: 1 }], { r1: 0, c1: 0, r2: 0, c2: 1 }, 0, 0, { r1: 0, c1: 0, r2: 2, c2: 1 });
    expect(plan.ok).toBe(true);
    expect(plan.add).toEqual(['A1:B1', 'A2:B2', 'A3:B3']);
  });

  it('refuses when the target has a mismatched merge', () => {
    const store = new Store();
    store.addMerge('E5:F6'); // 2x2 merge where a 1x2 merge would land
    const plan = planMergePaste(store, [{ r1: 0, c1: 0, r2: 0, c2: 1 }], { r1: 0, c1: 0, r2: 0, c2: 1 }, 4, 4);
    expect(plan.ok).toBe(false);
    expect(plan.error).toBe('size-mismatch');
  });

  it('refuses a plain paste over existing merged cells', () => {
    const store = new Store();
    store.addMerge('A1:B1');
    const plan = planMergePaste(store, [], { r1: 0, c1: 0, r2: 0, c2: 1 }, 0, 0);
    expect(plan.ok).toBe(false);
    expect(plan.error).toBe('plain-over-merged');
  });

  it('lets a single plain cell land inside a merged cell (Excel keeps the merge)', () => {
    const store = new Store();
    store.addMerge('A1:B1');
    // Clicking the merged cell snaps the selection to the whole merge (1x2).
    const plan = planMergePaste(store, [], { r1: 0, c1: 0, r2: 0, c2: 0 }, 0, 0, { r1: 0, c1: 0, r2: 0, c2: 1 });
    expect(plan.ok).toBe(true);
    expect(plan.rect).toEqual({ r1: 0, c1: 0, r2: 0, c2: 0 }); // anchor cell only
    expect(plan.add).toEqual([]); // merge preserved
  });

  it('refuses a single plain cell when the target spans a merge plus more', () => {
    const store = new Store();
    store.addMerge('B1:B2');
    const plan = planMergePaste(store, [], { r1: 0, c1: 0, r2: 0, c2: 0 }, 0, 0, { r1: 0, c1: 0, r2: 1, c2: 1 });
    expect(plan.ok).toBe(false);
    expect(plan.error).toBe('plain-over-merged');
  });

  it('accepts when the target merge matches exactly (repeat paste)', () => {
    const store = new Store();
    store.addMerge('E5:F5');
    const plan = planMergePaste(store, [{ r1: 0, c1: 0, r2: 0, c2: 1 }], { r1: 0, c1: 0, r2: 0, c2: 1 }, 4, 4);
    expect(plan.ok).toBe(true);
    expect(plan.add).toEqual([]);
  });

  it('ignores merges outside the paste rect', () => {
    const store = new Store();
    store.addMerge('A1:B1');
    const plan = planMergePaste(store, [], { r1: 0, c1: 0, r2: 0, c2: 1 }, 10, 10);
    expect(plan.ok).toBe(true);
  });
});

describe('ApplyMergeChanges', () => {
  it('adds and removes merges with undo', () => {
    const store = new Store();
    store.addMerge('A1:B1');
    const cmd = new ApplyMergeChanges({ add: ['D4:E4'], remove: ['A1:B1'] });

    cmd.execute(store);
    expect(store.getMerges()).toEqual(['D4:E4']);

    cmd.getUndo().execute(store);
    expect(store.getMerges()).toEqual(['A1:B1']);
  });
});
