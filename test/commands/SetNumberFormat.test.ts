import { describe, expect, it } from 'vitest';
import { SetNumberFormatCommand } from '../../src/commands/impl/SetNumberFormat';
import { Store } from '../../src/store/Store';

describe('SetNumberFormatCommand', () => {
  it('applies number format to a cell range', () => {
    const store = new Store();
    store.setCell(0, 0, { text: '100', value: 100 });

    new SetNumberFormatCommand({ r1: 0, c1: 0, r2: 0, c2: 0, numberFormat: 'currency' }).execute(store);

    const cell = store.getCell(0, 0);
    expect(cell?.styleId).toBeDefined();
    const style = store.getStyle(cell?.styleId ?? '');
    expect(style?.numberFormat).toBe('currency');
  });

  it('undo restores previous format', () => {
    const store = new Store();
    store.setCell(0, 0, { text: '0.5', value: 0.5 });

    const cmd = new SetNumberFormatCommand({ r1: 0, c1: 0, r2: 0, c2: 0, numberFormat: 'percent' });
    cmd.execute(store);
    cmd.getUndo().execute(store);

    const cell = store.getCell(0, 0);
    const style = cell?.styleId !== undefined ? store.getStyle(cell.styleId) : undefined;
    expect(style?.numberFormat).toBeUndefined();
  });
});
