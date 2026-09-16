/**
 * Hand-built xlsx fixture writer. SheetJS CE cannot *write* fonts/fills, so
 * importer tests build the zip (stored, no compression) with a custom
 * styles.xml / sheet xml directly.
 */

const CRC_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) !== 0 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i += 1) crc = CRC_TABLE[(crc ^ data[i]!) & 0xFF]! ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

export interface ZipEntry {
  readonly name: string;
  readonly content: string;
}

/** Minimal ZIP archive (stored entries), sufficient for SheetJS to read. */
export function buildZip(entries: readonly ZipEntry[]): ArrayBuffer {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  const u16 = (v: number): Uint8Array => new Uint8Array([v & 0xFF, (v >> 8) & 0xFF]);
  const u32 = (v: number): Uint8Array => new Uint8Array([v & 0xFF, (v >> 8) & 0xFF, (v >> 16) & 0xFF, (v >>> 24) & 0xFF]);
  const concat = (parts: Uint8Array[]): Uint8Array => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
  };

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const data = encoder.encode(entry.content);
    const crc = crc32(data);
    const local = concat([
      u32(0x04034B50), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
      u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), name, data,
    ]);
    central.push(concat([
      u32(0x02014B50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
      u32(crc), u32(data.length), u32(data.length), u16(name.length),
      u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name,
    ]));
    chunks.push(local);
    offset += local.length;
  }

  const centralStart = offset;
  const centralAll = concat(central);
  const end = concat([
    u32(0x06054B50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(centralAll.length), u32(centralStart), u16(0),
  ]);
  const all = concat([...chunks, centralAll, end]);
  return all.buffer.slice(all.byteOffset, all.byteOffset + all.byteLength) as ArrayBuffer;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const WORKBOOK = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>
<sheet name="数据" sheetId="1" r:id="rId1"/>
<sheet name="Second" sheetId="2" r:id="rId2"/>
</sheets>
</workbook>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.000"/></numFmts>
<fonts count="3">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="14"/><color rgb="FFFF0000"/><name val="Arial"/></font>
<font><i/><u/><sz val="11"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
</styleSheet>`;

const SHEET1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<dimension ref="A1:B4"/>
<cols><col min="2" max="2" width="20" customWidth="1"/></cols>
<sheetData>
<row r="1"><c r="A1" s="1" t="inlineStr"><is><t>标题</t></is></c><c r="B1" s="3"><v>1234.5</v></c></row>
<row r="2"><c r="A2" t="b"><v>1</v></c><c r="B2" t="e"><v>#DIV/0!</v></c></row>
<row r="3" ht="30" customHeight="1"><c r="A3" s="4"><v>45000</v></c><c r="B3"><f>B1*2</f><v>2469</v></c></row>
<row r="4"><c r="A4" s="1"/><c r="B4" s="2"/></row>
</sheetData>
<mergeCells count="1"><mergeCell ref="A4:B4"/></mergeCells>
</worksheet>`;

const SHEET2 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<dimension ref="A1"/>
<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>第二页</t></is></c></row></sheetData>
</worksheet>`;

/** Full-featured fixture: styles, merges, formula, bool, error, number+date formats, row/col sizes, 2 sheets. */
export function buildFixtureXlsx(): ArrayBuffer {
  return buildZip([
    { name: '[Content_Types].xml', content: CONTENT_TYPES },
    { name: '_rels/.rels', content: ROOT_RELS },
    { name: 'xl/workbook.xml', content: WORKBOOK },
    { name: 'xl/_rels/workbook.xml.rels', content: WORKBOOK_RELS },
    { name: 'xl/styles.xml', content: STYLES },
    { name: 'xl/worksheets/sheet1.xml', content: SHEET1 },
    { name: 'xl/worksheets/sheet2.xml', content: SHEET2 },
  ]);
}
