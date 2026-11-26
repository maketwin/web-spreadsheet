import { describe, expect, it, vi } from 'vitest';
import { read } from 'xlsx';
import * as XLSXLib from 'xlsx';
import type * as XlsxModule from 'xlsx';
import type { CellObject, WorkSheet } from 'xlsx';
import { zipSync } from 'fflate';
import { importXlsx } from '../../src/io/XlsxImporter';
import { safeUnzip, ZipTooLargeError } from '../../src/io/safeUnzip';
import { TOTAL_COLS, TOTAL_ROWS } from '../../src/util/gridSize';
import { buildWorkbookXlsx } from './xlsxFixture';

// The reader's namespace is not spy-able; wrap the real function instead.
vi.mock('xlsx', async (importOriginal) => {
  const actual = await importOriginal<typeof XlsxModule>();
  return { ...actual, read: vi.fn(actual.read) };
});

function workbookBytes(cells: Record<string, CellObject>, ref = 'A1:B2'): ArrayBuffer {
  const ws: WorkSheet = { ...cells, '!ref': ref };
  const wb = XLSXLib.utils.book_new();
  XLSXLib.utils.book_append_sheet(wb, ws, 'Sheet1');
  return XLSXLib.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

// The grid is Excel's whole address space (1,048,576 × 16,384): real files
// cannot exceed it, so import keeps everything a legal file holds and no
// longer reports truncation. Coordinates past the space come only from
// crafted files and are dirty data — dropped silently. The zip-bomb guards
// are scale-independent and must stay.
const LAST_ROW = TOTAL_ROWS; // 1-based row of the last addressable row
const LAST_COL = XLSXLib.utils.encode_col(TOTAL_COLS - 1); // XFD
const BEYOND_ROW = TOTAL_ROWS + 1; // 1-based row past the address space
const BEYOND_COL = XLSXLib.utils.encode_col(TOTAL_COLS); // XFE

/** Sheet xml with cells at the space's edges plus crafted beyond-space cells. */
const farSheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<dimension ref="A1:${BEYOND_COL}${BEYOND_ROW}"/>
<sheetData>
<row r="1"><c r="A1" t="n"><v>1</v></c><c r="${LAST_COL}1" t="n"><v>4</v></c><c r="${BEYOND_COL}1" t="n"><v>3</v></c></row>
<row r="${LAST_ROW}"><c r="${LAST_COL}${LAST_ROW}" t="n"><v>5</v></c></row>
<row r="${BEYOND_ROW}"><c r="A${BEYOND_ROW}" t="n"><v>2</v></c></row>
</sheetData>
<mergeCells count="2"><mergeCell ref="A1:B2"/><mergeCell ref="A1:A${BEYOND_ROW}"/></mergeCells>
</worksheet>`;

describe('xlsx import limits', () => {
  it('keeps the whole address space and drops only beyond-space cells silently', () => {
    const warnings: string[] = [];
    const result = importXlsx(buildWorkbookXlsx({ sheets: [farSheetXml] }), (warning) => { warnings.push(warning); });
    const keys = result.sheets[0]!.data.cells.map(([key]) => key);
    expect(keys).toContain('0,0');
    // The legal edges of the address space import intact.
    expect(keys).toContain(`0,${TOTAL_COLS - 1}`); // XFD1
    expect(keys).toContain(`${TOTAL_ROWS - 1},${TOTAL_COLS - 1}`); // XFD1048576
    // Past the space (XFE1 / A1048577) is crafted garbage: dropped, no warning.
    expect(keys).not.toContain(`0,${TOTAL_COLS}`);
    expect(keys).not.toContain(`${TOTAL_ROWS},0`);
    // The in-space merge survives; the one reaching past the bottom is dropped.
    expect(result.sheets[0]!.data.merges).toEqual(['A1:B2']);
    expect(warnings).toEqual([]);
  });

  it('says nothing when everything fits', () => {
    const warnings: string[] = [];
    importXlsx(workbookBytes({ A1: { t: 'n', v: 1 } }), (warning) => { warnings.push(warning); });
    expect(warnings).toEqual([]);
  });

  it('refuses an oversized package before the reader inflates it', () => {
    // 129 MB of zeros: tiny compressed, over the 128 MB entry limit once inflated.
    const zipped = zipSync({ 'xl/workbook.xml': new Uint8Array(129 * 1024 * 1024) });
    vi.mocked(read).mockClear();
    expect(() => importXlsx(zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength))).toThrow(ZipTooLargeError);
    expect(read).not.toHaveBeenCalled();
    // The counter is live: a normal import goes through the reader.
    importXlsx(workbookBytes({ A1: { t: 'n', v: 1 } }));
    expect(read).toHaveBeenCalledTimes(1);
  });
});

describe('safeUnzip', () => {
  const MIB = 1024 * 1024;

  it('admits an entry at the 128 MiB limit and a package at the 256 MiB total limit', () => {
    // Two cap-sized entries sum to exactly the total limit: still allowed.
    // (A million-row worksheet part is ~50 MB — honest Excel output fits.)
    const zipped = zipSync({ 'a.bin': new Uint8Array(128 * MIB), 'b.bin': new Uint8Array(128 * MIB) });
    const files = safeUnzip(zipped);
    expect(Object.keys(files).sort()).toEqual(['a.bin', 'b.bin']);
    expect(files['a.bin']!.length).toBe(128 * MIB);
    expect(() => safeUnzip(zipped, { oversized: 'throw' })).not.toThrow();
  });

  it('rejects an entry past the 128 MiB limit on its declared size, before inflating', () => {
    const zipped = zipSync({ 'big.bin': new Uint8Array(128 * MIB + 1) });
    expect(Object.keys(safeUnzip(zipped))).toEqual([]);
    expect(() => safeUnzip(zipped, { oversized: 'throw' })).toThrow(ZipTooLargeError);
  });

  it('rejects a package past the 256 MiB total limit', () => {
    // Each entry fits the entry limit; the third crosses the total.
    const zipped = zipSync({ 'a.bin': new Uint8Array(128 * MIB), 'b.bin': new Uint8Array(128 * MIB), 'c.txt': new Uint8Array([1]) });
    expect(() => safeUnzip(zipped, { oversized: 'throw' })).toThrow(ZipTooLargeError);
  });

  it('never inflates a lying entry past its declared size', () => {
    // Hand-built package: a deflate entry of 1011 real bytes whose central
    // directory claims 4. fflate trusts the declaration for the output buffer,
    // so the result is truncated at 4 bytes — no amplification.
    const zipped = new Uint8Array(zipSync({ 'a.txt': new Uint8Array(1011) }));
    const view = new DataView(zipped.buffer);
    for (let i = 0; i < zipped.length - 4; i += 1) {
      if (zipped[i] === 0x50 && zipped[i + 1] === 0x4b && zipped[i + 2] === 0x01 && zipped[i + 3] === 0x02) {
        view.setUint32(i + 24, 4, true); // central originalSize → 4
      }
    }
    const files = safeUnzip(zipped);
    expect(files['a.txt']!.length).toBe(4);
  });

  it('rejects a bomb on its declared size without inflating it', () => {
    // Same hand-built trick in the other direction: 11 real bytes claiming
    // 300 MB. The filter reads the declaration from the central directory and
    // refuses before any decompression happens.
    const zipped = new Uint8Array(zipSync({ 'bomb.bin': new Uint8Array(11) }));
    const view = new DataView(zipped.buffer);
    for (let i = 0; i < zipped.length - 4; i += 1) {
      if (zipped[i] === 0x50 && zipped[i + 1] === 0x4b && zipped[i + 2] === 0x01 && zipped[i + 3] === 0x02) {
        view.setUint32(i + 24, 300 * MIB, true); // central originalSize → 300 MB
      }
    }
    expect(Object.keys(safeUnzip(zipped))).toEqual([]);
    expect(() => safeUnzip(zipped, { oversized: 'throw' })).toThrow(ZipTooLargeError);
  });

  it('inflates a normal package either way', () => {
    const normal = zipSync({ 'a.txt': new Uint8Array([1, 2, 3]) });
    expect(Object.keys(safeUnzip(normal))).toEqual(['a.txt']);
    expect(Object.keys(safeUnzip(normal, { oversized: 'throw' }))).toEqual(['a.txt']);
  });
});
