import { describe, expect, it } from 'vitest';
import { SetAutoFilterCommand } from '../../src/commands/impl/SetAutoFilter';
import { SetAutoFilterCriteriaCommand } from '../../src/commands/impl/SetAutoFilterCriteria';
import { Store } from '../../src/store/Store';

function setup(store: Store): void {
  store.setCell(0, 0, { text: 'name' });
  store.setCell(1, 0, { text: 'apple' });
  store.setCell(2, 0, { text: 'banana' });
}

describe('SetAutoFilterCommand undo', () => {
  it('undo of enable removes the autofilter', () => {
    const store = new Store();
    setup(store);
    const cmd = new SetAutoFilterCommand({ r1: 0, c1: 0, r2: 2, c2: 0, enabled: true });

    cmd.execute(store);
    expect(store.getAutoFilter()).toBeDefined();

    cmd.getUndo().execute(store);
    expect(store.getAutoFilter()).toBeUndefined();
  });

  it('undo of disable restores the previous filter state including criteria', () => {
    const store = new Store();
    setup(store);
    new SetAutoFilterCommand({ r1: 0, c1: 0, r2: 2, c2: 0, enabled: true }).execute(store);
    new SetAutoFilterCriteriaCommand({ column: 0, criteria: { selected: ['apple'], includeBlanks: false }, mode: 'set' }).execute(store);
    const before = store.getAutoFilter();

    const disable = new SetAutoFilterCommand({ r1: 0, c1: 0, r2: 2, c2: 0, enabled: false });
    disable.execute(store);
    expect(store.getAutoFilter()).toBeUndefined();

    disable.getUndo().execute(store);
    expect(store.getAutoFilter()).toEqual(before);
  });

  it('undo of disable restores rows hidden by criteria', () => {
    const store = new Store();
    setup(store);
    new SetAutoFilterCommand({ r1: 0, c1: 0, r2: 2, c2: 0, enabled: true }).execute(store);
    new SetAutoFilterCriteriaCommand({ column: 0, criteria: { selected: ['apple'], includeBlanks: false }, mode: 'set' }).execute(store);
    expect(store.getRow(2)?.hide).toBe(true);

    const disable = new SetAutoFilterCommand({ r1: 0, c1: 0, r2: 2, c2: 0, enabled: false });
    disable.execute(store);
    expect(store.getRow(2)?.hide ?? false).toBe(false);

    disable.getUndo().execute(store);
    expect(store.getRow(2)?.hide).toBe(true);
  });
});

describe('SetAutoFilterCriteriaCommand undo', () => {
  it('undo restores previous criteria and hidden rows', () => {
    const store = new Store();
    setup(store);
    new SetAutoFilterCommand({ r1: 0, c1: 0, r2: 2, c2: 0, enabled: true }).execute(store);

    const cmd = new SetAutoFilterCriteriaCommand({ column: 0, criteria: { selected: ['apple'], includeBlanks: false }, mode: 'set' });
    cmd.execute(store);
    expect(store.getRow(2)?.hide).toBe(true);

    cmd.getUndo().execute(store);
    expect(store.getAutoFilter()?.criteria).toEqual({});
    expect(store.getRow(2)?.hide ?? false).toBe(false);
  });

  it('undo of clearColumn restores the cleared criteria', () => {
    const store = new Store();
    setup(store);
    new SetAutoFilterCommand({ r1: 0, c1: 0, r2: 2, c2: 0, enabled: true }).execute(store);
    new SetAutoFilterCriteriaCommand({ column: 0, criteria: { selected: ['apple'], includeBlanks: false }, mode: 'set' }).execute(store);

    const clear = new SetAutoFilterCriteriaCommand({ column: 0, mode: 'clearColumn' });
    clear.execute(store);
    expect(store.getAutoFilter()?.criteria).toEqual({});

    clear.getUndo().execute(store);
    expect(store.getAutoFilter()?.criteria).toEqual({ 0: { selected: ['apple'], includeBlanks: false } });
    expect(store.getRow(2)?.hide).toBe(true);
  });

  it('undo of clearAll restores all criteria', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'name' });
    store.setCell(0, 1, { text: 'qty' });
    store.setCell(1, 0, { text: 'apple' });
    store.setCell(1, 1, { text: '5' });
    new SetAutoFilterCommand({ r1: 0, c1: 0, r2: 1, c2: 1, enabled: true }).execute(store);
    new SetAutoFilterCriteriaCommand({ column: 0, criteria: { selected: ['apple'], includeBlanks: false }, mode: 'set' }).execute(store);
    new SetAutoFilterCriteriaCommand({ column: 1, criteria: { selected: ['5'], includeBlanks: false }, mode: 'set' }).execute(store);

    const clear = new SetAutoFilterCriteriaCommand({ column: 0, mode: 'clearAll' });
    clear.execute(store);
    expect(store.getAutoFilter()?.criteria).toEqual({});

    clear.getUndo().execute(store);
    expect(store.getAutoFilter()?.criteria).toEqual({ 0: { selected: ['apple'], includeBlanks: false }, 1: { selected: ['5'], includeBlanks: false } });
  });
});
