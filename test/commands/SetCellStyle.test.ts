import { describe, expect, it } from 'vitest';
import { SetCellStyleCommand } from '../../src/commands/impl/SetCellStyle';
import { SetRangeStyleCommand } from '../../src/commands/impl/SetRangeStyle';
import { Store } from '../../src/store/Store';

describe('SetCellStyleCommand', () => {
  it('applies style to a cell', () => {
    const store = new Store();

    new SetCellStyleCommand({ r: 0, c: 0, style: { bold: true, fontSize: 16 } }).execute(store);

    const styleId = store.getCell(0, 0)?.styleId;
    expect(styleId).toBe('cell-0-0');
    expect(store.getStyle(styleId ?? '')).toEqual({ bold: true, fontSize: 16 });
  });

  it('undo restores the previous cell and style', () => {
    const store = new Store();
    store.setStyle('old', { italic: true });
    store.setCell(0, 0, { text: 'A1', styleId: 'old' });
    const cmd = new SetCellStyleCommand({ r: 0, c: 0, style: { bold: true } });

    cmd.execute(store);
    cmd.getUndo().execute(store);

    expect(store.getCell(0, 0)).toEqual({ text: 'A1', styleId: 'old' });
    expect(store.getStyle('old')).toEqual({ italic: true });
  });
});

describe('SetRangeStyleCommand', () => {
  it('applies style to each cell in a range', () => {
    const store = new Store();

    new SetRangeStyleCommand({ r1: 0, c1: 0, r2: 1, c2: 1, style: { align: 'center' } }).execute(store);

    expect(store.getStyle(store.getCell(1, 1)?.styleId ?? '')).toEqual({ align: 'center' });
  });
});
