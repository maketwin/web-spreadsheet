import { describe, expect, it } from 'vitest';
import { SortRangeCommand } from '../../src/commands/impl/SortRange';
import { Store } from '../../src/store/Store';

function fill(store: Store, rows: readonly (readonly string[])[]): void {
  rows.forEach((row, r) => row.forEach((text, c) => store.setCell(r, c, { text })));
}

function readCol(store: Store, c: number, r1: number, r2: number): string[] {
  const out: string[] = [];
  for (let r = r1; r <= r2; r += 1) out.push(store.getCell(r, c)?.text ?? '');
  return out;
}

describe('SortRangeCommand undo', () => {
  it('undo restores the original row order after ascending sort', () => {
    const store = new Store();
    fill(store, [['c', '1'], ['a', '2'], ['b', '3']]);
    const cmd = new SortRangeCommand({ r1: 0, c1: 0, r2: 2, c2: 1, sortCol: 0, direction: 'asc' });

    cmd.execute(store);
    expect(readCol(store, 0, 0, 2)).toEqual(['a', 'b', 'c']);

    cmd.getUndo().execute(store);
    expect(readCol(store, 0, 0, 2)).toEqual(['c', 'a', 'b']);
    expect(readCol(store, 1, 0, 2)).toEqual(['1', '2', '3']);
  });

  it('undo restores the original row order after descending sort', () => {
    const store = new Store();
    fill(store, [['a'], ['c'], ['b']]);
    const cmd = new SortRangeCommand({ r1: 0, c1: 0, r2: 2, c2: 0, sortCol: 0, direction: 'desc' });

    cmd.execute(store);
    expect(readCol(store, 0, 0, 2)).toEqual(['c', 'b', 'a']);

    cmd.getUndo().execute(store);
    expect(readCol(store, 0, 0, 2)).toEqual(['a', 'c', 'b']);
  });

  it('undo restores cleared cells to undefined', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'b' });
    store.setCell(2, 0, { text: 'a' });
    const cmd = new SortRangeCommand({ r1: 0, c1: 0, r2: 2, c2: 0, sortCol: 0, direction: 'asc' });

    cmd.execute(store);
    cmd.getUndo().execute(store);

    expect(store.getCell(0, 0)?.text).toBe('b');
    expect(store.getCell(1, 0)).toBeUndefined();
    expect(store.getCell(2, 0)?.text).toBe('a');
  });

  it('redo (undo of undo) re-applies the sorted order', () => {
    const store = new Store();
    fill(store, [['b'], ['a']]);
    const cmd = new SortRangeCommand({ r1: 0, c1: 0, r2: 1, c2: 0, sortCol: 0, direction: 'asc' });

    cmd.execute(store);
    const undo = cmd.getUndo();
    undo.execute(store);
    undo.getUndo().execute(store);

    expect(readCol(store, 0, 0, 1)).toEqual(['a', 'b']);
  });
});
