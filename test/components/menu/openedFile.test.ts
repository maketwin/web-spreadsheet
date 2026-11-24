import { describe, expect, it } from 'vitest';
import { openedFileKind, parseWorkbookJson } from '../../../src/components/menu/MenuBar';
import { Store } from '../../../src/store/Store';

// The "打开…" box used to decode whatever it was given as text, so an .xlsx
// chosen there was parsed as CSV out of its binary, and any valid JSON was
// handed to the store as a workbook.
describe('openedFileKind', () => {
  const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);
  const text = new Uint8Array([...new TextEncoder().encode('a,b\r\n1,2')]);

  it('routes by extension, and by the zip signature whatever the name', () => {
    expect(openedFileKind('report.xlsx', zip)).toBe('xlsx');
    expect(openedFileKind('report.XLSX', zip)).toBe('xlsx');
    expect(openedFileKind('renamed.bin', zip)).toBe('xlsx');
    expect(openedFileKind('book.json', new TextEncoder().encode('{}'))).toBe('json');
    expect(openedFileKind('data.csv', text)).toBe('text');
    expect(openedFileKind('data.tsv', text)).toBe('text');
    expect(openedFileKind('noext', text)).toBe('text');
  });
});

describe('parseWorkbookJson', () => {
  it('accepts what the store serializes', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'x', value: 'x' });
    expect(parseWorkbookJson(JSON.stringify(store.serialize()))).toEqual(store.serialize());
  });

  it('rejects JSON that is not a workbook', () => {
    const cases = ['[]', '"text"', '{}', '{"sheets":[]}', '{"sheets":{}}',
      JSON.stringify({ sheets: [{ id: 'a', name: 'A' }] }),
      JSON.stringify({ sheets: [{ id: 'a', name: 'A', data: { cells: [] } }] }),
      JSON.stringify({ sheets: [{ id: 1, name: 'A', data: new Store().serialize().sheets[0]!.data }] })];
    for (const text of cases) expect(() => parseWorkbookJson(text), text).toThrow(/不是工作簿文件/);
  });

  it('lets a syntax error through as such', () => {
    expect(() => parseWorkbookJson('{oops')).toThrow(SyntaxError);
  });
});
