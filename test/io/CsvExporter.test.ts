import { describe, expect, it } from 'vitest';
import { csvQuote, exportCsv, exportCsvBlob, CsvRangeTooLargeError } from '../../src/io/CsvExporter';
import { Store } from '../../src/store/Store';
import { TOTAL_COLS, TOTAL_ROWS } from '../../src/util/gridSize';

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

  it('guards text that Excel would read as a formula', () => {
    expect(csvQuote('=cmd|\' /C calc\'!A0')).toBe('\'=cmd|\' /C calc\'!A0');
    expect(csvQuote('@SUM(1)')).toBe('\'@SUM(1)');
    expect(csvQuote('+1+1')).toBe('\'+1+1');
    expect(csvQuote('-1+2')).toBe('\'-1+2');
    expect(csvQuote('-A1')).toBe('\'-A1');
  });

  it('does not guard negative numbers, however they are displayed', () => {
    // A text cell holding a negative number: not a formula either way.
    expect(csvQuote('-1234.50')).toBe('-1234.50');
    expect(csvQuote('-1,234.50')).toBe('"-1,234.50"');
    expect(csvQuote('-12.50%')).toBe('-12.50%');
    expect(csvQuote('-$1,234.50')).toBe('"-$1,234.50"');
    // A number cell displayed with a format: the apostrophe used to turn it into text in Excel.
    expect(csvQuote('-1,234.50', -1234.5)).toBe('"-1,234.50"');
    expect(csvQuote('-12.50%', -0.125)).toBe('-12.50%');
    expect(csvQuote('(1,234.50)', -1234.5)).toBe('"(1,234.50)"');
    // A text result that starts with "=" is still a formula to Excel.
    expect(csvQuote('=-1+2', '=-1+2')).toBe('\'=-1+2');
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

  it('exports negative formatted numbers without the formula guard', () => {
    const store = new Store();
    store.setStyle('money', { numberFormat: '#,##0.00' });
    store.setStyle('pct', { numberFormat: 'percent' });
    store.setCell(0, 0, { text: '-1234.5', value: -1234.5, styleId: 'money' });
    store.setCell(0, 1, { text: '-0.125', value: -0.125, styleId: 'pct' });
    store.setCell(0, 2, { formula: '=-A1', text: '1234.50', value: 1234.5, styleId: 'money' });

    expect(exportCsv(store)).toBe('"-1,234.50",-12.50%,"1,234.50"');
  });

  it('writes booleans as TRUE/FALSE and empty cells as empty fields', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'TRUE', value: true });
    store.setCell(0, 2, { text: 'x', value: 'x' });

    expect(exportCsv(store)).toBe('TRUE,,x');
  });

  it('exports cells anywhere in the address space (the grid is Excel-sized)', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'ok', value: 'ok' });
    store.setCell(0, 30, { text: 'far', value: 'far' }); // past the old 26-column grid
    store.setCell(2, 0, { text: 'low', value: 'low' }); // past the old 1000-row grid

    // The used-range rectangle stays dense: empty rows and fields in between.
    const blank = (n: number): string => Array<string>(n).fill('').join(',');
    expect(exportCsv(store)).toBe(['ok' + ','.repeat(30) + 'far', blank(31), 'low' + ','.repeat(30)].join('\r\n'));
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

describe('exportCsv effective styles', () => {
  it('applies a column default number format to cells without their own style', () => {
    const store = new Store();
    store.setStyle('pct', { numberFormat: 'percent' });
    store.setCol(0, { styleId: 'pct' });
    store.setCell(0, 0, { text: '0.5', value: 0.5 });
    // The cell has no styleId; the format comes from Store.getCellStyle (cell > row > column).
    expect(store.getCell(0, 0)?.styleId).toBeUndefined();
    expect(exportCsv(store)).toBe('50.00%');
  });

  it('applies a row default number format the same way', () => {
    const store = new Store();
    store.setStyle('money', { numberFormat: '#,##0.00' });
    store.setRow(0, { styleId: 'money' });
    store.setCell(0, 1, { text: '1234.5', value: 1234.5 });
    expect(exportCsv(store)).toBe(',"1,234.50"'); // field 0 stays empty
  });

  it('refuses a used range whose area exceeds the dense ceiling, with a user-readable error', () => {
    const store = new Store();
    store.setCell(0, 0, { text: '左上', value: '左上' });
    // Two corners 17 billion addresses apart: a dense rows × cols walk would
    // take minutes, so the export refuses instead of trying.
    store.setCell(TOTAL_ROWS - 1, TOTAL_COLS - 1, { text: '右下', value: '右下' });
    expect(() => exportCsv(store)).toThrow(CsvRangeTooLargeError);
    expect(() => exportCsv(store)).toThrow('已用区域过大，无法导出为 CSV');
    expect(() => exportCsvBlob(store)).toThrow(CsvRangeTooLargeError);
  });

  it('keeps exporting while the area is within the ceiling', () => {
    const store = new Store();
    store.setCell(0, 0, { text: '左上', value: '左上' });
    // 1000×1000 = 1,000,000 empty addresses between the corners — under the
    // 2,000,000 ceiling, so the dense walk happens exactly as before.
    store.setCell(999, 999, { text: '右下', value: '右下' });
    const csv = exportCsv(store);
    expect(csv.split('\r\n')).toHaveLength(1000);
    expect(csv.startsWith('左上')).toBe(true);
    expect(csv.endsWith('右下')).toBe(true);
  });
});
