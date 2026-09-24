import { paperPx, type PrintSettings } from '../print/types';
import type { PrintPagesResult } from '../print/PrintPipeline';

/**
 * 手写最小 PDF 导出：把打印预览的每页画布转成 JPEG，以 DCTDecode 内嵌到
 * 每页一个 XObject 中。不引入任何依赖；结构为 Catalog → Pages → (Page +
 * Content + Image) × n → xref。
 */

const PT_PER_PX = 0.75; // 96dpi CSS px → 72dpi PDF pt

export async function exportPagesToPdf(result: PrintPagesResult, settings: PrintSettings): Promise<Blob> {
  const jpegs: Uint8Array[] = [];
  for (const canvas of result.canvases) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    if (blob === null) throw new Error('canvas.toBlob unavailable');
    jpegs.push(new Uint8Array(await blob.arrayBuffer()));
  }
  const paper = paperPx(settings);
  const pageW = paper.w * PT_PER_PX;
  const pageH = paper.h * PT_PER_PX;
  const bytes = buildPdfFromJpegs(jpegs, pageW, pageH);
  return new Blob([bytes as BlobPart], { type: 'application/pdf' });
}

/** Build a minimal PDF (one JPEG per page) from raw JPEG streams. */
export function buildPdfFromJpegs(jpegs: readonly Uint8Array[], pageW: number, pageH: number): Uint8Array {
  const chunks: Uint8Array[] = [];
  let offset = 0;
  const objectOffsets: number[] = [];
  const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
  const add = (bytes: Uint8Array): void => {
    chunks.push(bytes);
    offset += bytes.length;
  };
  const push = (bytes: Uint8Array): void => {
    objectOffsets.push(offset);
    add(bytes);
  };
  const beginObj = (id: number): void => {
    push(enc(`${id} 0 obj\n`));
  };
  const obj = (body: string): void => {
    add(enc(body));
  };
  const endObj = (): void => {
    add(enc('\nendobj\n'));
  };
  const raw = (bytes: Uint8Array): void => {
    add(bytes);
  };

  add(enc('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'));

  const n = jpegs.length;
  // 1 = catalog, 2 = pages, then per page: page, content, image (3 each).
  const firstPageId = 3;

  beginObj(1);
  obj(`<< /Type /Catalog /Pages 2 0 R >>\n`);
  endObj();

  const kids = Array.from({ length: n }, (_, i) => `${firstPageId + i * 3} 0 R`).join(' ');
  beginObj(2);
  obj(`<< /Type /Pages /Kids [${kids}] /Count ${n} >>\n`);
  endObj();

  jpegs.forEach((jpeg, i) => {
    const pageId = firstPageId + i * 3;
    const contentId = pageId + 1;
    const imageId = pageId + 2;

    // JPEG 尺寸从 SOF0/SOF2 段解析（宽高在前部）。
    const dim = jpegSize(jpeg);

    beginObj(pageId);
    obj(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fmt(pageW)} ${fmt(pageH)}] /Contents ${contentId} 0 R /Resources << /XObject << /Im${i} ${imageId} 0 R >> >> >>\n`);
    endObj();

    const content = `q\n${fmt(pageW)} 0 0 ${fmt(pageH)} 0 0 cm\n/Im${i} Do\nQ\n`;
    beginObj(contentId);
    obj(`<< /Length ${content.length} >>\nstream\n`);
    raw(enc(content));
    obj('endstream\n');
    endObj();

    beginObj(imageId);
    obj(`<< /Type /XObject /Subtype /Image /Width ${dim.width} /Height ${dim.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
    raw(jpeg);
    obj('\nendstream\n');
    endObj();
  });

  const xrefAt = offset;
  let xref = `xref\n0 ${objectOffsets.length + 1}\n0000000000 65535 f \n`;
  for (const off of objectOffsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`;
  push(enc(xref));
  push(enc(`trailer\n<< /Size ${objectOffsets.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`));

  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/** JPEG SOF0/SOF2 帧头里的像素尺寸。 */
function jpegSize(jpeg: Uint8Array): { width: number; height: number } {
  let at = 2; // 跳过 SOI
  while (at + 9 < jpeg.length) {
    const b0 = jpeg[at];
    const b1 = jpeg[at + 1];
    if (b0 === undefined || b1 === undefined || b0 !== 0xff) { at += 1; continue; }
    const marker = b1;
    const lenHi = jpeg[at + 2];
    const lenLo = jpeg[at + 3];
    if (lenHi === undefined || lenLo === undefined) break;
    const length = (lenHi << 8) + lenLo;
    // SOF0–SOF15（去掉 DHT/RST 的 0xC4/0xC8/0xCC）
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const hHi = jpeg[at + 5];
      const hLo = jpeg[at + 6];
      const wHi = jpeg[at + 7];
      const wLo = jpeg[at + 8];
      if (hHi === undefined || hLo === undefined || wHi === undefined || wLo === undefined) break;
      return { width: (wHi << 8) + wLo, height: (hHi << 8) + hLo };
    }
    at += 2 + length;
  }
  // 解析失败时给出 1×1，PDF 仍合法（内容为空页）。
  return { width: 1, height: 1 };
}
