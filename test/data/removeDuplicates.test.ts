import { describe, expect, it } from 'vitest';
import { buildRowKeys, findDuplicateRows } from '../../src/data/removeDuplicates';
import { RemoveDuplicatesCommand } from '../../src/commands/impl/RemoveDuplicates';
import { Store } from '../../src/store/Store';

describe('findDuplicateRows', () => {
  it('keeps first occurrence and skips header', () => {
    const keys = [
      ['Name', 'City'],
      ['Ann', 'NY'],
      ['Bob', 'LA'],
      ['Ann', 'NY'],
      ['Ann', 'SF'],
    ];
    expect(findDuplicateRows(keys, { hasHeader: true })).toEqual([3]);
    expect(findDuplicateRows(keys, { hasHeader: false }).length).toBeGreaterThan(0);
  });

  it('buildRowKeys reads selected columns', () => {
    const getText = (r: number, c: number): string => `${r},${c}`;
    const rows = buildRowKeys(getText, { r1: 0, c1: 1, r2: 1, c2: 3 }, [0, 2]);
    expect(rows).toEqual([['0,1', '0,3'], ['1,1', '1,3']]);
  });
});

describe('RemoveDuplicatesCommand', () => {
  it('deletes duplicate worksheet rows and undoes', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'Name' });
    store.setCell(0, 1, { text: 'City' });
    store.setCell(1, 0, { text: 'Ann' });
    store.setCell(1, 1, { text: 'NY' });
    store.setCell(2, 0, { text: 'Bob' });
    store.setCell(2, 1, { text: 'LA' });
    store.setCell(3, 0, { text: 'Ann' });
    store.setCell(3, 1, { text: 'NY' });
    const cmd = new RemoveDuplicatesCommand({
      r1: 0, c1: 0, r2: 3, c2: 1, columns: [0, 1], hasHeader: true,
    });
    cmd.execute(store);
    expect(cmd.removedCount()).toBe(1);
    expect(store.getCell(1, 0)?.text).toBe('Ann');
    expect(store.getCell(2, 0)?.text).toBe('Bob');
    expect(store.getCell(3, 0)).toBeUndefined();
    cmd.getUndo().execute(store);
    expect(store.getCell(3, 0)?.text).toBe('Ann');
  });
});
