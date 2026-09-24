import { describe, expect, it } from 'vitest';
import { Store } from '../../src/store/Store';

describe('Store.copySheet / moveSheet (Excel 移动或复制)', () => {
  it('copies sheet data and names Sheet1 (2)', () => {
    const store = new Store();
    const a = store.getActiveSheetId();
    store.setCell(0, 0, { text: 'hello', value: 'hello' });
    const copyId = store.copySheet(a);
    expect(copyId).toBeDefined();
    expect(store.getSheets().map((s) => s.name)).toContain('Sheet1 (2)');
    expect(store.getCell(0, 0, copyId!)?.text).toBe('hello');
    // source untouched
    expect(store.getCell(0, 0, a)?.text).toBe('hello');
    store.setCell(0, 0, { text: 'changed' }, a);
    expect(store.getCell(0, 0, copyId!)?.text).toBe('hello');
  });

  it('inserts copy before a target sheet', () => {
    const store = new Store();
    const first = store.getActiveSheetId();
    const second = store.addSheet('Sheet2');
    store.activateSheet(first);
    store.setCell(1, 1, { text: 'x' });
    const copyId = store.copySheet(first, { beforeSheetId: second })!;
    const order = store.getSheets().map((s) => s.id);
    expect(order.indexOf(copyId)).toBeLessThan(order.indexOf(second));
    expect(store.getActiveSheetId()).toBe(copyId);
  });

  it('uniqueCopyName bumps (2) (3)', () => {
    const store = new Store();
    const a = store.getActiveSheetId();
    store.copySheet(a);
    store.copySheet(a);
    const names = store.getSheets().map((s) => s.name);
    expect(names).toEqual(expect.arrayContaining(['Sheet1', 'Sheet1 (2)', 'Sheet1 (3)']));
  });
});
