import { describe, expect, it } from 'vitest';
import { buildPdfFromJpegs } from '../../src/io/pdfExport';

/** 最小 JPEG：SOI + SOF0(8.5×11) + EOI，够 jpegSize 解析即可。 */
function fakeJpeg(width: number, height: number): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x0b, 0x08, (height >> 8) & 0xff, height & 0xff, (width >> 8) & 0xff, width & 0xff, 0x01, 0x01, 0x00,
    0xff, 0xd9,
  ]);
}

describe('PDF export', () => {
  it('builds a valid multi-page PDF from JPEG pages', () => {
    const pdf = buildPdfFromJpegs([fakeJpeg(660, 880), fakeJpeg(660, 880)], 595, 842);
    const text = new TextDecoder('latin1').decode(pdf);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('/Type /Catalog');
    expect(text).toContain('/Count 2');
    expect(text).toContain('/Filter /DCTDecode');
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    // xref 表起点正确；首个条目指向对象 1（catalog）。
    const xrefAt = Number(text.match(/startxref\n(\d+)/)?.[1] ?? -1);
    expect(xrefAt).toBeGreaterThan(0);
    expect(text.slice(xrefAt, xrefAt + 5)).toBe('xref\n');
    const entry1 = text.slice(xrefAt).split('\n')[3]?.slice(0, 10);
    const obj1 = Number(entry1);
    expect(text.slice(obj1, obj1 + 7)).toBe('1 0 obj');
  });

  it('single page keeps MediaBox from the requested size', () => {
    const pdf = buildPdfFromJpegs([fakeJpeg(660, 880)], 595, 842);
    const text = new TextDecoder('latin1').decode(pdf);
    expect(text).toContain('/MediaBox [0 0 595 842]');
  });
});
