import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { parseSharedStrings, sheetStringCells } from '../../src/io/sharedStrings';
import { importXlsx } from '../../src/io/XlsxImporter';
import { exportXlsxBuffer } from '../../src/io/XlsxExporter';
import { Store } from '../../src/store/Store';
import { SetCellText } from '../../src/commands/impl/SetCellText';

const RUN_XML = '<r><rPr><b/><i/><u/><strike/><sz val="14"/><color rgb="FF0000FF"/><rFont val="宋体"/><vertAlign val="superscript"/></rPr><t>你 &amp; 我</t></r>';
const PLAIN_XML = '<r><t>world</t></r>';

function si(body: string): string {
  return `<si>${body}</si>`;
}

describe('parseSharedStrings', () => {
  it('parses plain si entries', () => {
    expect(parseSharedStrings(si('<t><space>hello</t>'))).toEqual([{ text: '<space>hello' }]);
  });

  it('parses runs with all rPr attributes and preserves spaces/entities', () => {
    const entries = parseSharedStrings(si(`${RUN_XML}${PLAIN_XML}`));
    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(entry.text).toBe('你 & 我world');
    expect(entry.runs).toEqual([
      { text: '你 & 我', style: { bold: true, italic: true, underline: true, strike: true, fontSize: 14, color: '#0000FF', fontFamily: '宋体', vertAlign: 'superscript' } },
      { text: 'world' },
    ]);
  });

  it('keeps a leading plain segment before the first run', () => {
    const entries = parseSharedStrings(si('<t>lead</t><r><rPr><b/></rPr><t>x</t></r>'));
    expect(entries[0]!.text).toBe('leadx');
    expect(entries[0]!.runs).toEqual([{ text: 'lead' }, { text: 'x', style: { bold: true } }]);
  });

  it('drops phonetic rPh blocks', () => {
    const entries = parseSharedStrings(si(`<r><t>漢字</t></r><rPh><t>かんじ</t></rPh>`));
    expect(entries[0]!.text).toBe('漢字');
  });

  it('maps theme colors through the approximate palette', () => {
    const entries = parseSharedStrings(si('<r><rPr><color theme="1"/></rPr><t>x</t></r>'));
    expect(entries[0]!.runs).toEqual([{ text: 'x', style: { color: '#000000' } }]);
  });

  it('empty sst parses to nothing', () => {
    expect(parseSharedStrings('')).toEqual([]);
  });
});

describe('sheetStringCells', () => {
  const xml = '<worksheet><sheetData>'
    + '<c r="A1" t="s"><v>3</v></c>'
    + '<c r="B2" t="inlineStr"><is><r><rPr><b/></rPr><t>bold</t></r></is></c>'
    + '<c r="C3"><v>42</v></c>'
    + '<c r="D4"/>'
    + '</sheetData></worksheet>';

  it('maps shared indices and inline runs, ignoring other cells', () => {
    const map = sheetStringCells(xml);
    expect(map.get('A1')).toEqual({ shared: 3 });
    expect(map.get('B2')!.runs).toEqual([{ text: 'bold', style: { bold: true } }]);
    expect(map.has('C3')).toBe(false);
    expect(map.has('D4')).toBe(false);
  });

  it('empty xml yields an empty map', () => {
    expect(sheetStringCells('').size).toBe(0);
  });
});

/** Minimal but valid workbook skeleton for SheetJS + our raw parsers. */
function buildXlsx(sheetDataXml: string, sharedStringsXml: string): ArrayBuffer {
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
      + '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>'
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + '</Types>'),
    '_rels/.rels': strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
      + '</Relationships>'),
    'xl/workbook.xml': strToU8('<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
      + '</Relationships>'),
    'xl/styles.xml': strToU8('<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font/></fonts><fills count="1"><fill/></fills><cellXfs count="1"><xf/></cellXfs></styleSheet>'),
    'xl/sharedStrings.xml': strToU8(`<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${sharedStringsXml}</sst>`),
    'xl/worksheets/sheet1.xml': strToU8(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetDataXml}</sheetData></worksheet>`),
  };
  return zipSync(files).buffer as ArrayBuffer;
}

describe('importXlsx rich text', () => {
  it('attaches runs from shared strings and inline strings; drops them on formula cells', () => {
    const buf = buildXlsx(
      '<c r="A1" t="s"><v>0</v></c>'
      + '<c r="A2" t="s"><v>1</v></c>'
      + '<c r="A3" t="inlineStr"><is><r><rPr><color rgb="FFFF0000"/></rPr><t>red</t></r><r><t> tail</t></r></is></c>'
      + '<c r="A4" t="s"><f>A2</f><v>1</v></c>',
      si('<t xml:space="preserve">  padded  </t>')
      + si(`<r><rPr><b/><color rgb="FF00FF00"/></rPr><t>粗体</t></r><r><t>plain</t></r>`),
    );
    const restored = importXlsx(buf);
    const cells = new Map(restored.sheets[0]!.data.cells);

    const a1 = cells.get('0,0')!;
    expect(a1.text).toBe('  padded  ');
    expect(a1.richText).toBeUndefined();

    const a2 = cells.get('1,0')!;
    expect(a2.text).toBe('粗体plain');
    expect(a2.richText).toEqual([
      { text: '粗体', style: { bold: true, color: '#00FF00' } },
      { text: 'plain' },
    ]);

    const a3 = cells.get('2,0')!;
    expect(a3.text).toBe('red tail');
    expect(a3.richText).toEqual([{ text: 'red', style: { color: '#FF0000' } }, { text: ' tail' }]);

    const a4 = cells.get('3,0')!;
    expect(a4.formula).toBe('=A2');
    expect(a4.richText).toBeUndefined();
  });
});

describe('exportXlsx styles + rich text round-trip', () => {
  function storeWithStyles(): Store {
    const store = new Store();
    new SetCellText({ r: 0, c: 0, text: '你好world', richText: [{ text: '你好', style: { bold: true, color: '#FF0000', fontSize: 14 } }, { text: 'world' }] }).execute(store);

    store.setStyle('s-yellow', { bgcolor: '#FFFF00', bold: true, fontSize: 14, color: '#FF0000', align: 'center' });
    store.setCell(1, 1, { text: '高亮', value: '高亮', styleId: 's-yellow' });

    store.setStyle('s-cur', { numberFormat: 'currency' });
    store.setCell(2, 2, { text: '10', value: 10, styleId: 's-cur' });

    store.setCell(3, 3, { text: 'plain', value: 'plain' });
    return store;
  }

  it('runs, cell styles, and number formats survive export → import', () => {
    const restored = importXlsx(exportXlsxBuffer(storeWithStyles()));
    const cells = new Map(restored.sheets[0]!.data.cells);
    const styles = new Map(restored.sheets[0]!.data.styles);

    const a1 = cells.get('0,0')!;
    expect(a1.text).toBe('你好world');
    expect(a1.richText).toEqual([
      { text: '你好', style: { bold: true, color: '#FF0000', fontSize: 14 } },
      { text: 'world' },
    ]);

    const b2 = cells.get('1,1')!;
    expect(b2.styleId).toBeDefined();
    const b2Style = styles.get(b2.styleId!) ?? {};
    expect(b2Style.bgcolor).toBe('#FFFF00');
    expect(b2Style.bold).toBe(true);
    expect(b2Style.fontSize).toBe(14);
    expect(b2Style.color).toBe('#FF0000');
    expect(b2Style.align).toBe('center');

    const c3 = cells.get('2,2')!;
    expect(c3.value).toBe(10);
    const c3Style = styles.get(c3.styleId!) ?? {};
    expect(c3Style.numberFormat).toBe('currency');

    const d4 = cells.get('3,3')!;
    expect(d4.text).toBe('plain');
    expect(d4.richText).toBeUndefined();
  });

  it('a workbook with no styles still round-trips plain text', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'plain', value: 'plain' });
    const restored = importXlsx(exportXlsxBuffer(store));
    const cells = new Map(restored.sheets[0]!.data.cells);
    expect(cells.get('0,0')!.text).toBe('plain');
  });
});
