import { describe, expect, it } from 'vitest';
import { SetNumberFormatCommand } from '../../src/commands/impl/SetNumberFormat';
import { exportXlsxBuffer } from '../../src/io/XlsxExporter';
import { importXlsx } from '../../src/io/XlsxImporter';
import { Store } from '../../src/store/Store';
import type { Cell } from '../../src/types';
import type { SerializedSheetData } from '../../src/store/SheetData';

function cellAt(data: SerializedSheetData, r: number, c: number): Cell | undefined {
  return data.cells.find(([key]) => key === `${r},${c}`)?.[1];
}

function numberFormatAt(data: SerializedSheetData, r: number, c: number): string | undefined {
  const cell = cellAt(data, r, c);
  if (cell?.styleId === undefined) return undefined;
  return data.styles.find(([id]) => id === cell.styleId)?.[1]?.numberFormat;
}

describe('xlsx number format round-trip (T3.2)', () => {
  it('custom format strings survive export → import', () => {
    const store = new Store();
    store.setCell(0, 0, { text: '1234.5', value: 1234.5 });
    new SetNumberFormatCommand({ r1: 0, c1: 0, r2: 0, c2: 0, numberFormat: '#,##0.00' }).execute(store);
    store.setCell(0, 1, { text: '0.25', value: 0.25 });
    new SetNumberFormatCommand({ r1: 0, c1: 1, r2: 0, c2: 1, numberFormat: '0.0%' }).execute(store);

    const buf = exportXlsxBuffer(store);
    const result = importXlsx(buf);
    const sheet = result.sheets[0]!.data;

    expect(cellAt(sheet, 0, 0)?.value).toBe(1234.5);
    expect(numberFormatAt(sheet, 0, 0)).toBe('number'); // '#,##0.00' reverse-maps to the built-in name
    expect(numberFormatAt(sheet, 0, 1)).toBe('0.0%');
  });

  it('built-in enum formats export as their xlsx equivalents and import back as the enum', () => {
    const store = new Store();
    store.setCell(0, 0, { text: '0.5', value: 0.5 });
    new SetNumberFormatCommand({ r1: 0, c1: 0, r2: 0, c2: 0, numberFormat: 'percent' }).execute(store);

    const result = importXlsx(exportXlsxBuffer(store));
    expect(numberFormatAt(result.sheets[0]!.data, 0, 0)).toBe('percent');
  });

  it('cells without explicit format import without a style', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'plain' });

    const result = importXlsx(exportXlsxBuffer(store));
    expect(numberFormatAt(result.sheets[0]!.data, 0, 0)).toBeUndefined();
  });
});
