import { describe, expect, it } from 'vitest';
import { csvQuote, exportCsv, exportCsvBlob } from '../../src/io/CsvExporter';
import { Store } from '../../src/store/Store';

describe('csvQuote', () => {
  it('leaves plain fields unquoted', () => {
    expect(csvQuote('hello')).toBe('hello');
    expect(csvQuote('123')).toBe('123');
  });

  it('quotes fields with separator, quote or newline and doubles quotes', () => {
    expect(csvQuote('a,b')).toBe('"a,b"');
    expect(csvQuote('say "hi"')).toBe('"say ""hi"""');
    expect(csvQuote('line1\nline2')).toBe('"line1\nline2"');
  });
});

describe('exportCsv', () => {
  it('exports the used range with CRLF rows', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'Name', value: 'Name' });
    store.setCell(0, 1, { text: 'Qty', value: 'Qty' });
    store.setCell(1, 0, { text: 'Widget', value: 'Widget' });
    store.setCell(1, 1, { text: '3', value: 3 });

    expect(exportCsv(store)).toBe('Name,Qty\r\nWidget,3');
  });

  it('exports displayed values with number formats applied (Excel parity)', () => {
    const store = new Store();
    store.setStyle('pct', { numberFormat: 'percent' });
    store.setStyle('money', { numberFormat: '#,##0.00' });
    store.setCell(0, 0, { text: '0.5', value: 0.5, styleId: 'pct' });
    store.setCell(0, 1, { text: '1234.5', value: 1234.5, styleId: 'money' });

    expect(exportCsv(store)).toBe('50.00%,"1,234.50"');
  });

  it('writes booleans as TRUE/FALSE and empty cells as empty fields', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'TRUE', value: true });
    store.setCell(0, 2, { text: 'x', value: 'x' });

    expect(exportCsv(store)).toBe('TRUE,,x');
  });

  it('ignores cells outside the fixed grid bounds', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'ok', value: 'ok' });
    store.setCell(0, 30, { text: 'far', value: 'far' }); // beyond TOTAL_COLS (26)
    store.setCell(1000, 0, { text: 'low', value: 'low' }); // beyond TOTAL_ROWS (1000)

    expect(exportCsv(store)).toBe('ok');
  });

  it('exports the computed value of formula cells, not the formula text', () => {
    const store = new Store();
    store.setCell(0, 0, { text: '1', value: 1 });
    store.setCell(0, 1, { text: '2', value: 2 });
    store.setCell(0, 2, { formula: '=SUM(A1:B1)', text: '3', value: 3 });

    expect(exportCsv(store)).toBe('1,2,3');
  });

  it('blob carries the UTF-8 BOM for Excel CJK import', () => {
    const store = new Store();
    store.setCell(0, 0, { text: '产品', value: '产品' });
    const blob = exportCsvBlob(store);
    // '产品' is 6 bytes in UTF-8; the BOM adds exactly 3 more.
    expect(blob.size).toBe(new Blob(['产品']).size + 3);
    expect(blob.type).toBe('text/csv;charset=utf-8');
  });
});
