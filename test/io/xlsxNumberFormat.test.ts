import { describe, expect, it } from 'vitest';
import { SetNumberFormatCommand } from '../../src/commands/impl/SetNumberFormat';
import { exportXlsxBuffer } from '../../src/io/XlsxExporter';
import { importXlsx } from '../../src/io/XlsxImporter';
import { Store } from '../../src/store/Store';

describe('xlsx number format round-trip (T3.2)', () => {
  it('custom format strings survive export → import', () => {
    const store = new Store();
    store.setCell(0, 0, { text: '1234.5', value: 1234.5 });
    new SetNumberFormatCommand({ r1: 0, c1: 0, r2: 0, c2: 0, numberFormat: '#,##0.00' }).execute(store);
    store.setCell(0, 1, { text: '0.25', value: 0.25 });
    new SetNumberFormatCommand({ r1: 0, c1: 1, r2: 0, c2: 1, numberFormat: '0.0%' }).execute(store);

    const buf = exportXlsxBuffer(store);
    const result = importXlsx(buf);
    const sheet = result.sheets[0]!;

    expect(sheet.cells[0]?.[0]?.value).toBe(1234.5);
    expect(sheet.numberFormats[0]?.[0]).toBe('#,##0.00');
    expect(sheet.numberFormats[0]?.[1]).toBe('0.0%');
  });

  it('built-in enum formats export as their xlsx equivalents', () => {
    const store = new Store();
    store.setCell(0, 0, { text: '0.5', value: 0.5 });
    new SetNumberFormatCommand({ r1: 0, c1: 0, r2: 0, c2: 0, numberFormat: 'percent' }).execute(store);

    const result = importXlsx(exportXlsxBuffer(store));
    expect(result.sheets[0]?.numberFormats[0]?.[0]).toBe('0.00%');
  });

  it('cells without explicit format import as undefined format', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'plain' });

    const result = importXlsx(exportXlsxBuffer(store));
    const fmt = result.sheets[0]?.numberFormats[0]?.[0];
    expect(fmt === undefined || fmt === 'General').toBe(true);
  });
});
