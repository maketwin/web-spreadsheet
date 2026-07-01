import { describe, expect, it } from 'vitest';
import { SetCellText } from '../../src/commands/impl/SetCellText';
import { Store } from '../../src/store/Store';

describe('SetCellText', () => {
  it('sets text', () => {
    const store = new Store();

    new SetCellText({ r: 0, c: 0, text: 'hi' }).execute(store);

    expect(store.getCell(0, 0)?.text).toBe('hi');
  });

  it('undo restores old', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'old' });
    const cmd = new SetCellText({ r: 0, c: 0, text: 'new' });

    cmd.execute(store);
    cmd.getUndo().execute(store);

    expect(store.getCell(0, 0)?.text).toBe('old');
  });

  it('preserves other props', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'x', type: 'number' });

    new SetCellText({ r: 0, c: 0, text: 'y' }).execute(store);

    expect(store.getCell(0, 0)).toEqual({ text: 'y', type: 'number' });
  });
});
