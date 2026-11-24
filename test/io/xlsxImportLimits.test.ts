import { describe, expect, it, vi } from 'vitest';
import { read } from 'xlsx';
import * as XLSXLib from 'xlsx';
import type * as XlsxModule from 'xlsx';
import type { CellObject, Range as CellRange, WorkSheet } from 'xlsx';
import { zipSync } from 'fflate';
import { importXlsx } from '../../src/io/XlsxImporter';
import { safeUnzip, ZipTooLargeError } from '../../src/io/safeUnzip';
import { TOTAL_COLS, TOTAL_ROWS } from '../../src/util/gridSize';

// The reader's namespace is not spy-able; wrap the real function instead.
vi.mock('xlsx', async (importOriginal) => {
  const actual = await importOriginal<typeof XlsxModule>();
  return { ...actual, read: vi.fn(actual.read) };
});

function workbookBytes(cells: Record<string, CellObject>, merges?: CellRange[]): ArrayBuffer {
  const range = { s: { r: 0, c: 0 }, e: { r: TOTAL_ROWS, c: TOTAL_COLS } };
  const ws: WorkSheet = { ...cells, '!ref': XLSXLib.utils.encode_range(range), ...(merges !== undefined ? { '!merges': merges } : {}) };
  const wb = XLSXLib.utils.book_new();
  XLSXLib.utils.book_append_sheet(wb, ws, 'Sheet1');
  return XLSXLib.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

// The grid is fixed at 1000 × 26: an import that quietly loses everything
// past it looks like success, and a package bomb must be stopped before the
// reader inflates it.
describe('xlsx import limits', () => {
  it('reports cells and merges beyond the grid instead of dropping them silently', () => {
    const bytes = workbookBytes(
      { A1: { t: 'n', v: 1 }, [`${XLSXLib.utils.encode_col(TOTAL_COLS)}1`]: { t: 'n', v: 3 }, [`A${TOTAL_ROWS + 1}`]: { t: 'n', v: 2 } },
      [{ s: { r: 0, c: 0 }, e: { r: 1, c: 1 } }, { s: { r: 0, c: 0 }, e: { r: TOTAL_ROWS, c: 0 } }],
    );
    const warnings: string[] = [];
    const result = importXlsx(bytes, (warning) => { warnings.push(warning); });
    const keys = result.sheets[0]!.data.cells.map(([key]) => key);
    expect(keys).toContain('0,0');
    expect(keys).not.toContain(`${TOTAL_ROWS},0`);
    expect(keys).not.toContain(`0,${TOTAL_COLS}`);
    expect(result.sheets[0]!.data.merges).toEqual(['A1:B2']);
    expect(warnings.some((warning) => warning.includes('2 个单元格'))).toBe(true);
    expect(warnings.some((warning) => warning.includes('1 个合并区域'))).toBe(true);
  });

  it('says nothing when everything fits', () => {
    const warnings: string[] = [];
    importXlsx(workbookBytes({ A1: { t: 'n', v: 1 } }), (warning) => { warnings.push(warning); });
    expect(warnings).toEqual([]);
  });

  it('refuses an oversized package before the reader inflates it', () => {
    // 33 MB of zeros: tiny compressed, over the 32 MB entry limit once inflated.
    const zipped = zipSync({ 'xl/workbook.xml': new Uint8Array(33 * 1024 * 1024) });
    vi.mocked(read).mockClear();
    expect(() => importXlsx(zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength))).toThrow(ZipTooLargeError);
    expect(read).not.toHaveBeenCalled();
    // The counter is live: a normal import goes through the reader.
    importXlsx(workbookBytes({ A1: { t: 'n', v: 1 } }));
    expect(read).toHaveBeenCalledTimes(1);
  });
});

describe('safeUnzip', () => {
  const zipped = zipSync({ 'big.bin': new Uint8Array(33 * 1024 * 1024) });

  it('skips an oversized entry by default (packages this app wrote itself)', () => {
    expect(Object.keys(safeUnzip(zipped))).toEqual([]);
  });

  it('refuses the whole package when asked to', () => {
    expect(() => safeUnzip(zipped, { oversized: 'throw' })).toThrow(ZipTooLargeError);
  });

  it('inflates a normal package either way', () => {
    const normal = zipSync({ 'a.txt': new Uint8Array([1, 2, 3]) });
    expect(Object.keys(safeUnzip(normal))).toEqual(['a.txt']);
    expect(Object.keys(safeUnzip(normal, { oversized: 'throw' }))).toEqual(['a.txt']);
  });
});
