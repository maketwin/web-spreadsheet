import { describe, expect, it } from 'vitest';
import { SetRangeValues, type CellPatch } from '../../src/commands/impl/SetRangeValues';
import { Store } from '../../src/store/Store';

/** The patch the clear paths (Delete, 清除内容, blank paste) write. */
const clearPatch = (): CellPatch => ({ text: '', formula: undefined, value: undefined, styleId: undefined, type: undefined, richText: undefined, hyperlink: undefined });
const clearMatrix = (rows: number, cols: number): CellPatch[][] => Array.from({ length: rows }, () => Array.from({ length: cols }, clearPatch));

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

    // Overwriting with empty text leaves nothing stored: the stale formula and
    // value are gone with the cell, not parked in a `{ text: '' }` ghost.
    expect(store.getCell(0, 0)).toBeUndefined();
  });

  it('clearing an all-blank block stores no ghost cells', () => {
    const store = new Store();
    store.setCell(4, 4, { text: 'unrelated' });

    new SetRangeValues({ r1: 0, c1: 0, r2: 2, c2: 2, values: clearMatrix(3, 3) }).execute(store);

    expect(store.getCellCount()).toBe(1);
    expect(store.getCell(0, 0)).toBeUndefined();
    // The used range was not stretched by the clear (Ctrl+End stays put).
    expect(store.getUsedBounds()).toEqual({ r1: 4, c1: 4, r2: 4, c2: 4 });
  });

  it('clearing a data block removes its cells; undo restores them verbatim', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'a', type: 'number', styleId: 's1' });
    store.setCell(2, 2, { text: 'c' });

    const cmd = new SetRangeValues({ r1: 0, c1: 0, r2: 2, c2: 2, values: clearMatrix(3, 3) });
    cmd.execute(store);
    expect(store.getCellCount()).toBe(0);
    expect(store.getCell(0, 0)).toBeUndefined();
    expect(store.getCell(2, 2)).toBeUndefined();

    cmd.getUndo().execute(store);
    expect(store.getCell(0, 0)).toEqual({ text: 'a', type: 'number', styleId: 's1' });
    expect(store.getCell(2, 2)).toEqual({ text: 'c' });
    expect(store.getCellCount()).toBe(2);
  });

  it('clear keeps cells that still carry a field (style, comment, spill shadow)', () => {
    const store = new Store();
    store.setCell(0, 0, { text: '', styleId: 's' });
    store.setCell(1, 0, { text: '', comment: { text: 'note' } });
    store.setCell(2, 0, { text: '', spillOf: 'sheet:5,5' });

    // A text-only blank (no styleId key) keeps the cell's own style.
    new SetRangeValues({ r1: 0, c1: 0, r2: 0, c2: 0, values: [[{ text: '' }]] }).execute(store);
    expect(store.getCell(0, 0)).toEqual({ text: '', styleId: 's' });

    // The full clear patch names styleId: undefined (Delete clears formats
    // too), so a styled blank loses the style and the cell; but comment and
    // spill shadow are not in the patch and keep the cell alive.
    new SetRangeValues({ r1: 1, c1: 0, r2: 2, c2: 0, values: clearMatrix(2, 1) }).execute(store);
    expect(store.getCell(0, 0)).toEqual({ text: '', styleId: 's' });
    expect(store.getCell(1, 0)?.comment).toEqual({ text: 'note' });
    expect(store.getCell(2, 0)?.spillOf).toBe('sheet:5,5');
    expect(store.getCellCount()).toBe(3);
  });
});
