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
    const cells = result.sheets[0]!.data.cells;
    const at = (r: number, c: number): { text?: string; value?: unknown } | undefined =>
      cells.find(([key]) => key === `${r},${c}`)?.[1];
    expect(at(0, 0)?.text).toBe('Name');
    expect(at(0, 1)?.value).toBe(100);
    expect(at(1, 0)?.text).toBe('Test');
  });

  it('exports merges and formulas (round-trip)', () => {
    const store = new Store();
    store.setCell(0, 0, { text: '2', value: 2 });
    store.setCell(0, 1, { text: '3', value: 3 });
    store.setCell(1, 0, { text: '5', value: 5, formula: '=A1+B1' });
    store.addMerge('A3:B4');

    const result = importXlsx(exportXlsxBuffer(store));
    const data = result.sheets[0]!.data;
    expect(data.merges).toEqual(['A3:B4']);
    const formulaCell = data.cells.find(([key]) => key === '1,0')?.[1];
    expect(formulaCell?.formula).toBe('=A1+B1');
    expect(formulaCell?.value).toBe(5);
  });
});
