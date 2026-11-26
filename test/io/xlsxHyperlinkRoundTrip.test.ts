import { describe, expect, it } from 'vitest';
import { exportXlsxBuffer } from '../../src/io/XlsxExporter';
import { importXlsx } from '../../src/io/XlsxImporter';
import { Store } from '../../src/store/Store';
import { TOTAL_ROWS } from '../../src/util/gridSize';
import { buildWorkbookXlsx } from './xlsxFixture';

/**
 * Hyperlink targets carry XML-escaped text in the rels part (`&` → `&amp;`).
 * SheetJS escapes on write but reads attributes raw, so the importer decodes
 * — a target exported with `&` comes back with `&`, and Excel-written files
 * (rels carry `&amp;`) decode too. Internal `location` links are unaffected
 * (SheetJS already decodes those).
 */

function linkStore(): Store {
  const store = new Store();
  store.setCell(0, 0, {
    text: '外部', value: '外部',
    hyperlink: { target: 'https://example.com/?a=1&b=2', tooltip: '提示 & 更多' },
  });
  store.setCell(1, 0, { text: '内部', value: '内部', hyperlink: { target: '#Sheet1!B4' } });
  return store;
}

describe('xlsx hyperlink targets', () => {
  it('round-trips & in targets and tooltips (plain path)', () => {
    const source = linkStore();
    const imported = importXlsx(exportXlsxBuffer(source));
    const cells = new Map(imported.sheets[0]!.data.cells);
    expect(cells.get('0,0')?.hyperlink).toEqual({ target: 'https://example.com/?a=1&b=2', tooltip: '提示 & 更多' });
    expect(cells.get('1,0')?.hyperlink).toEqual({ target: '#Sheet1!B4' });
  });

  it('round-trips & in targets and tooltips (packed path)', () => {
    const source = linkStore();
    source.setCell(TOTAL_ROWS - 1, 0, { text: '触发', value: '触发' });
    const imported = importXlsx(exportXlsxBuffer(source));
    const cells = new Map(imported.sheets[0]!.data.cells);
    expect(cells.get('0,0')?.hyperlink).toEqual({ target: 'https://example.com/?a=1&b=2', tooltip: '提示 & 更多' });
    expect(cells.get('1,0')?.hyperlink).toEqual({ target: '#Sheet1!B4' });
    expect(cells.get(`${TOTAL_ROWS - 1},0`)?.value).toBe('触发');
  });

  it('decodes an Excel-style rels target written as &amp;', () => {
    // Excel escapes rels Target per XML rules; the importer must decode it.
    const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<dimension ref="A1:B2"/>
<sheetData><row r="1"><c r="A1" t="str"><v>链接</v></c></row><row r="2"><c r="B2" t="str"><v>内部</v></c></row></sheetData>
<hyperlinks><hyperlink ref="A1" r:id="rId1" tooltip="提示 &amp; 更多"/><hyperlink ref="B2" location="Sheet1!B4"/></hyperlinks>
</worksheet>`;
    const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/?a=1&amp;b=2" TargetMode="External"/>
</Relationships>`;
    const imported = importXlsx(buildWorkbookXlsx({
      sheets: [sheet],
      binaryParts: [{ name: 'xl/worksheets/_rels/sheet1.xml.rels', content: rels }],
    }));
    const cells = new Map(imported.sheets[0]!.data.cells);
    expect(cells.get('0,0')?.hyperlink).toEqual({ target: 'https://example.com/?a=1&b=2', tooltip: '提示 & 更多' });
    expect(cells.get('1,1')?.hyperlink).toEqual({ target: '#Sheet1!B4' }); // B2
  });
});
