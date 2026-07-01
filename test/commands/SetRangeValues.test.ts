import { describe, expect, it } from 'vitest';
import { SetRangeValues } from '../../src/commands/impl/SetRangeValues';
import { Store } from '../../src/store/Store';

describe('SetRangeValues', () => {
  it('sets values in a range', () => {
    const store = new Store();

    new SetRangeValues({
      r1: 0,
      c1: 0,
      r2: 1,
      c2: 1,
      values: [[{ text: 'A1' }, { text: 'B1' }], [{ text: 'A2' }, { text: 'B2' }]],
    }).execute(store);

    expect(store.getCell(0, 0)?.text).toBe('A1');
    expect(store.getCell(0, 1)?.text).toBe('B1');
    expect(store.getCell(1, 0)?.text).toBe('A2');
    expect(store.getCell(1, 1)?.text).toBe('B2');
  });

  it('undo restores the whole range', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'old A1', type: 'text' });
    store.setCell(1, 1, { text: 'old B2' });
    const cmd = new SetRangeValues({
      r1: 0,
      c1: 0,
      r2: 1,
      c2: 1,
      values: [[{ text: 'new A1' }, { text: 'new B1' }], [{ text: 'new A2' }, { text: 'new B2' }]],
    });

    cmd.execute(store);
    cmd.getUndo().execute(store);

    expect(store.getCell(0, 0)).toEqual({ text: 'old A1', type: 'text' });
    expect(store.getCell(0, 1)).toBeUndefined();
    expect(store.getCell(1, 0)).toBeUndefined();
    expect(store.getCell(1, 1)).toEqual({ text: 'old B2' });
  });

  it('clears stale formulas when text is overwritten', () => {
    const store = new Store();
    store.setCell(0, 0, { text: '3', formula: '=SUM(1,2)', value: 3 });

    new SetRangeValues({
      r1: 0,
      c1: 0,
      r2: 0,
      c2: 0,
      values: [[{ text: '' }]],
    }).execute(store);

    expect(store.getCell(0, 0)).toEqual({ text: '' });
  });
});
