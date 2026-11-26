import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { exportXlsxBuffer } from '../../src/io/XlsxExporter';
import { importXlsx } from '../../src/io/XlsxImporter';
import { Store } from '../../src/store/Store';
import { TOTAL_COLS, TOTAL_ROWS } from '../../src/util/gridSize';
import { buildWorkbookXlsx } from './xlsxFixture';

/**
 * Column/row axis metadata (width, hidden, default style) in xlsx: the export
 * writes `<cols>` and `<row ht/hidden/s>` itself (SheetJS's community writer
 * merges columns, drops styles and only dresses rows with cells), the import
 * reads `<col style>` ranges and `<row s customFormat>` back into axis meta —
 * cells without their own style stay styleless and inherit at read time
 * (Store.getCellStyle: cell > row > column).
 */

/** A sheet exercising every axis flavor, plus cells that inherit. */
function axisStore(): Store {
  const store = new Store();
  store.setStyle('col-pct', { numberFormat: 'percent' });
  store.setStyle('col-fill', { bgcolor: '#FFF2CC' });
  store.setStyle('row-bold', { bold: true, color: '#003366' });
  store.setStyle('own', { italic: true });

  store.setCol(0, { width: 120 });
  store.setCol(1, { width: 90 });
  store.setCol(2, { hide: true });
  store.setCol(4, { styleId: 'col-pct' });
  store.setCol(5, { width: 33, styleId: 'col-fill' });
  store.setRow(0, { height: 28 });
  store.setRow(3, { hide: true });
  store.setRow(4, { styleId: 'row-bold' });
  store.setRow(5, { height: 45, styleId: 'row-bold' });

  store.setCell(0, 0, { text: 'plain', value: 'plain' });
  store.setCell(1, 4, { text: '0.5', value: 0.5 }); // inherits the column format
  store.setCell(4, 0, { text: 'row', value: 'row' }); // inherits the row style
  store.setCell(5, 5, { text: 'both', value: 'both' }); // row 5 wins over col 5
  store.setCell(6, 6, { text: 'own', value: 'own', styleId: 'own' }); // own style wins
  return store;
}

/** styleId strings are store-local; compare the resolved styles instead. The styles pipeline fills in the default font (Calibri 11) on write, so containment is the exact contract. */
function axisEquals(store: Store, source: Store): void {
  for (const [c, meta] of source.getColEntries()) {
    const got = store.getCol(c);
    const styleId = meta.styleId;
    if (styleId === undefined) expect(got).toEqual(meta);
    else {
      expect(got?.width).toBe(meta.width);
      expect(got?.hide).toBe(meta.hide);
      expect(store.getStyle(got?.styleId ?? '')).toMatchObject(source.getStyle(styleId) as object);
    }
  }
  for (const [r, meta] of source.getRowEntries()) {
    const got = store.getRow(r);
    const styleId = meta.styleId;
    if (styleId === undefined) expect(got).toEqual(meta);
    else {
      expect(got?.height).toBe(meta.height);
      expect(got?.hide).toBe(meta.hide);
      expect(store.getStyle(got?.styleId ?? '')).toMatchObject(source.getStyle(styleId) as object);
    }
  }
}

describe('xlsx axis meta round trip', () => {
  it('writes <cols> in the schema slot with widths, hidden and per-column styles', () => {
    const files = unzipSync(new Uint8Array(exportXlsxBuffer(axisStore())));
    const xml = strFromU8(files['xl/worksheets/sheet1.xml']!);
    expect(xml.indexOf('<sheetViews>')).toBeLessThan(xml.indexOf('<cols>'));
    expect(xml.indexOf('<cols>')).toBeLessThan(xml.indexOf('<sheetData>'));
    expect(xml).toContain('<col min="1" max="1" width="16.43" customWidth="1"/>');
    expect(xml).toContain('<col min="2" max="2" width="12.14" customWidth="1"/>');
    expect(xml).toContain('<col min="3" max="3" hidden="1"/>');
    expect(xml).toContain('<col min="6" max="6" width="4" customWidth="1" style="');
    // The col style index points into the styles.xml cellXfs table.
    const xf = Number(xml.match(/<col min="5" max="5" style="(\d+)"/)?.[1]);
    const xfCount = Number(strFromU8(files['xl/styles.xml']!).match(/<cellXfs count="(\d+)"/)?.[1]);
    expect(xf).toBeLessThan(xfCount);
  });

  it('patches <row> attributes and inserts metadata-only rows ascending', () => {
    const files = unzipSync(new Uint8Array(exportXlsxBuffer(axisStore())));
    const xml = strFromU8(files['xl/worksheets/sheet1.xml']!);
    // Row 1 has a cell: attributes patched onto the existing open tag.
    expect(xml).toContain('<row r="1" ht="21" customHeight="1">');
    // Row 4 is hidden with no cells: a new self-closing row.
    expect(xml).toContain('<row r="4" hidden="1"/>');
    // Row 5 carries a style: s= + customFormat="1".
    expect(xml).toMatch(/<row r="5" s="\d+" customFormat="1">/);
    expect(xml).toContain('ht="33.75"');
    // Excel requires ascending row numbers inside sheetData.
    const rows = [...xml.matchAll(/<row r="(\d+)"/g)].map((m) => Number(m[1]));
    expect(rows).toEqual([...rows].sort((a, b) => a - b));
  });

  it('round-trips widths, heights, hidden flags and axis styles (plain path)', () => {
    const source = axisStore();
    const store = new Store();
    store.replaceAll(importXlsx(exportXlsxBuffer(source)));
    axisEquals(store, source);
    // Cells without their own style stay styleless — inheritance happens at
    // read time (Store.getCellStyle), never flattened onto the cell.
    expect(store.getCell(1, 4)?.styleId).toBeUndefined();
    expect(store.getCell(1, 4)?.value).toBe(0.5);
    expect(store.getCell(0, 0)?.styleId).toBeUndefined();
    expect(store.getCellStyle(1, 4)?.numberFormat).toBe('percent');
    expect(store.getCellStyle(4, 0)?.bold).toBe(true);
    expect(store.getCellStyle(5, 5)?.bold).toBe(true); // row wins over column
    expect(store.getCellStyle(5, 5)?.bgcolor).toBeUndefined();
    expect(store.getCellStyle(6, 6)?.italic).toBe(true); // own style wins
    expect(store.getCellStyle(2, 2)).toBeUndefined(); // nothing on row 2 / col 2
  });

  it('round-trips the same metadata through the packed path', () => {
    const source = axisStore();
    source.setCell(TOTAL_ROWS - 1, TOTAL_COLS - 1, { text: '触发', value: '触发' });
    const store = new Store();
    store.replaceAll(importXlsx(exportXlsxBuffer(source)));
    axisEquals(store, source);
    expect(store.getCellCount()).toBe(6);
    expect(store.getCell(TOTAL_ROWS - 1, TOTAL_COLS - 1)?.value).toBe('触发');
    expect(store.getCellStyle(1, 4)?.numberFormat).toBe('percent');
    expect(store.getCellStyle(4, 0)?.bold).toBe(true);
  });

  it('reads Excel-style <col>/<row> xml into axis meta without flattening cells', () => {
    // Fixture xf 3 carries the custom #,##0.000 format; xf 1 is bold 14px
    // Arial on yellow, centered (the shared fixture table).
    const imported = importXlsx(buildWorkbookXlsx({
      sheets: [`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<dimension ref="A1:B2"/>
<cols><col min="1" max="2" width="15" customWidth="1" style="3"/><col min="3" max="3" hidden="1"/></cols>
<sheetData>
<row r="1" ht="25" customHeight="1" s="1" customFormat="1"><c r="A1" t="n"><v>1</v></c></row>
<row r="2"><c r="A2" t="n"><v>2</v></c></row>
<row r="7" s="1" customFormat="1"/>
</sheetData>
</worksheet>`],
    }));
    const sheet = imported.sheets[0]!;
    const cols = new Map(sheet.data.cols);
    expect(cols.get(0)).toMatchObject({ width: 110 });
    expect(cols.get(1)).toMatchObject({ width: 110 });
    expect(cols.get(2)).toEqual({ hide: true });
    const rows = new Map(sheet.data.rows);
    expect(rows.get(0)).toMatchObject({ height: 33 });
    expect(rows.get(1)).toBeUndefined();
    expect(rows.get(6)).toBeDefined();
    // The axis styles resolve: col format from the custom numFmt, row style
    // from xf 1 — and the styleless cell inherits instead of flattening.
    const styleOf = (meta: { styleId?: string | undefined } | undefined) => {
      const id = meta?.styleId;
      return id === undefined ? undefined : sheet.data.styles.find(([sid]) => sid === id)?.[1];
    };
    expect(styleOf(cols.get(0))?.numberFormat).toBe('#,##0.000');
    expect(styleOf(rows.get(0))?.bold).toBe(true);
    expect(styleOf(rows.get(6))?.bold).toBe(true);
    const a1 = sheet.data.cells.find(([key]) => key === '0,0')!;
    expect(a1![1].styleId).toBeUndefined();
  });

  it('writes axis meta even for a sheet without any cell', () => {
    const store = new Store();
    store.setCol(3, { width: 100 });
    store.setRow(2, { height: 40 });
    const buf = exportXlsxBuffer(store);
    const files = unzipSync(new Uint8Array(buf));
    const xml = strFromU8(files['xl/worksheets/sheet1.xml']!);
    // The empty <sheetData/> gains the metadata-only row.
    expect(xml).toContain('<col min="4" max="4" width="13.57" customWidth="1"/>');
    expect(xml).toContain('<sheetData><row r="3" ht="30" customHeight="1"/></sheetData>');
    const reloaded = new Store();
    reloaded.replaceAll(importXlsx(buf));
    expect(reloaded.getCol(3)).toEqual({ width: 100 });
    expect(reloaded.getRow(2)).toEqual({ height: 40 });
  });

  it('keeps everything but the trigger identical between plain and packed export', () => {
    const plain = unzipSync(new Uint8Array(exportXlsxBuffer(axisStore())));
    const withTrigger = axisStore();
    withTrigger.setCell(TOTAL_ROWS - 1, 0, { text: '触发', value: '触发' });
    const packed = unzipSync(new Uint8Array(exportXlsxBuffer(withTrigger)));
    // <cols> is coordinate-free: byte-identical in both paths.
    const colsOf = (files: Record<string, Uint8Array>): string | undefined => {
      const xml = strFromU8(files['xl/worksheets/sheet1.xml']!);
      return xml.match(/<cols>[\s\S]*?<\/cols>/)?.[0];
    };
    expect(colsOf(packed)).toBe(colsOf(plain));
  });
});
