import { describe, expect, it } from 'vitest';
import { SetRangeStyleCommand } from '../../src/commands/impl/SetRangeStyle';
import { Store } from '../../src/store/Store';

describe('SetRangeStyleCommand undo', () => {
  it('undo restores previous styles across the range', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'a' });
    store.setCell(0, 1, { text: 'b' });

    const cmd = new SetRangeStyleCommand({ r1: 0, c1: 0, r2: 0, c2: 1, style: { bold: true, color: '#ff0000' } });
    cmd.execute(store);

    const styled = store.getCell(0, 0);
    expect(styled?.styleId).toBeDefined();
    expect(store.getStyle(styled!.styleId!)?.bold).toBe(true);

    cmd.getUndo().execute(store);
    expect(store.getCell(0, 0)?.styleId).toBeUndefined();
    expect(store.getCell(0, 1)?.styleId).toBeUndefined();
  });

  it('undo restores a pre-existing style rather than clearing it', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'a' });
    new SetRangeStyleCommand({ r1: 0, c1: 0, r2: 0, c2: 0, style: { italic: true } }).execute(store);
    const before = store.getCell(0, 0)?.styleId;

    const cmd = new SetRangeStyleCommand({ r1: 0, c1: 0, r2: 0, c2: 0, style: { bold: true } });
    cmd.execute(store);
    cmd.getUndo().execute(store);

    expect(store.getCell(0, 0)?.styleId).toBe(before);
    expect(store.getStyle(before!)?.italic).toBe(true);
  });
});
