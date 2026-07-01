import { describe, expect, it, vi } from 'vitest';
import { Spreadsheet } from '../../src/components/Spreadsheet';
import { CsvImportPlugin } from '../../src/plugins/CsvImportPlugin';

function createSpreadsheet(): Spreadsheet {
  return new Spreadsheet(document.createElement('div'), { theme: false });
}

describe('CsvImportPlugin', () => {
  it('install registers csv:import handler', () => {
    const spreadsheet = createSpreadsheet();
    const on = vi.spyOn(spreadsheet.events, 'on');

    spreadsheet.use(CsvImportPlugin);

    expect(on).toHaveBeenCalledWith('csv:import', expect.any(Function));
  });

  it('handler parses CSV and writes to store', () => {
    const spreadsheet = createSpreadsheet();

    spreadsheet.use(CsvImportPlugin);
    spreadsheet.events.emit('csv:import', ' A1 , B1 \n A2 , B2 ');

    expect(spreadsheet.store.getCell(0, 0)).toEqual({ text: 'A1' });
    expect(spreadsheet.store.getCell(0, 1)).toEqual({ text: 'B1' });
    expect(spreadsheet.store.getCell(1, 0)).toEqual({ text: 'A2' });
    expect(spreadsheet.store.getCell(1, 1)).toEqual({ text: 'B2' });
  });
});
