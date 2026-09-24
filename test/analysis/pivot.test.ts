import { describe, expect, it } from 'vitest';
import { Store } from '../../src/store/Store';
import { buildPivotToNewSheet } from '../../src/analysis/pivot';

function storeWithSales(): { store: Store; range: string } {
  const store = new Store();
  store.setCell(0, 0, { text: '类别', value: '类别' });
  store.setCell(0, 1, { text: '数量', value: '数量' });
  store.setCell(0, 2, { text: '金额', value: '金额' });
  store.setCell(1, 0, { text: '苹果', value: '苹果' });
  store.setCell(1, 1, { text: '10', value: 10 });
  store.setCell(1, 2, { text: '50', value: 50 });
  store.setCell(2, 0, { text: '香蕉', value: '香蕉' });
  store.setCell(2, 1, { text: '20', value: 20 });
  store.setCell(2, 2, { text: '80', value: 80 });
  store.setCell(3, 0, { text: '苹果', value: '苹果' });
  store.setCell(3, 1, { text: '5', value: 5 });
  store.setCell(3, 2, { text: '25', value: 25 });
  return { store, range: 'A1:C4' };
}

describe('buildPivotToNewSheet', () => {
  it('groups by first column and sums numeric columns into a new sheet', () => {
    const { store, range } = storeWithSales();
    const result = buildPivotToNewSheet(store, store.getActiveSheetId(), range);
    expect(result).not.toBeNull();
    const pivotId = result!.sheetId;
    expect(store.getSheets().some((s) => s.id === pivotId && s.name.startsWith('透视表'))).toBe(true);
    expect(store.getCell(0, 0, pivotId)?.text).toBe('类别');
    expect(store.getCell(1, 0, pivotId)?.text).toBe('苹果');
    expect(store.getCell(1, 1, pivotId)?.value).toBe(15);
    expect(store.getCell(1, 2, pivotId)?.value).toBe(75);
    expect(store.getCell(2, 0, pivotId)?.text).toBe('香蕉');
    expect(store.getCell(2, 1, pivotId)?.value).toBe(20);
    expect(store.activateSheet(pivotId)).toBe(true);
  });

  it('returns null when the range is a single cell', () => {
    const { store } = storeWithSales();
    expect(buildPivotToNewSheet(store, store.getActiveSheetId(), 'A1')).toBeNull();
  });
});
