import { describe, expect, it } from 'vitest';
import { SheetData } from '../../src/store/SheetData';

describe('SheetData', () => {
  it('stores and deletes cells independently', () => {
    const sheet = new SheetData();

    sheet.setCell(0, 0, { text: 'A1' });
    sheet.setCell(0, 0, undefined);

    expect(sheet.getCell(0, 0)).toBeUndefined();
  });

  it('stores row and column metadata', () => {
    const sheet = new SheetData();

    sheet.setRow(2, { height: 40 });
    sheet.setCol(3, { width: 160 });

    expect(sheet.getRow(2)).toEqual({ height: 40 });
    expect(sheet.getCol(3)).toEqual({ width: 160 });
  });

  it('serializes and restores sheet state', () => {
    const sheet = new SheetData();
    sheet.setCell(1, 1, { text: 'B2' });
    sheet.addMerge('A1:B2');

    const restored = SheetData.deserialize(sheet.serialize());

    expect(restored.getCell(1, 1)).toEqual({ text: 'B2' });
    expect(restored.getMerges()).toEqual(['A1:B2']);
  });
});
