import { describe, expect, it } from 'vitest';
import { exportXlsx, exportXlsxBuffer } from '../../src/io/XlsxExporter';
import { importXlsx } from '../../src/io/XlsxImporter';
import { Store } from '../../src/store/Store';

describe('XlsxExporter', () => {
  it('exports a valid xlsx blob', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'Hello', value: 'Hello' });
    store.setCell(0, 1, { text: '42', value: 42 });

    const blob = exportXlsx(store);
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  });

  it('round-trips data through export then import', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'Name', value: 'Name' });
    store.setCell(0, 1, { text: '100', value: 100 });
    store.setCell(1, 0, { text: 'Test', value: 'Test' });

    const buf = exportXlsxBuffer(store);
    const result = importXlsx(buf);

    expect(result.sheets.length).toBeGreaterThanOrEqual(1);
    const first = result.sheets[0]!;
    expect(first.cells[0]?.[0]?.text).toBe('Name');
    expect(first.cells[0]?.[1]?.value).toBe(100);
    expect(first.cells[1]?.[0]?.text).toBe('Test');
  });
});
