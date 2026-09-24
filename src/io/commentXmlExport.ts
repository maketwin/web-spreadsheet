import { zipSync, strFromU8, strToU8 } from 'fflate';
import { safeUnzip } from './safeUnzip';
import { num2alpha } from '../util/alphabet';
import type { Store } from '../store/Store';
import type { CellComment } from '../types';

/**
 * Comment (note) export: SheetJS cannot write comments, so the workbook zip is
 * post-processed — per sheet with comments we add `xl/commentsN.xml` plus a
 * legacy `xl/drawings/vmlDrawingN.vml` (the note shape Excel requires), wire
 * the sheet rels, `<legacyDrawing>` and content types.
 */

const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL_COMMENTS = `${REL_NS}/comments`;
const REL_VML = `${REL_NS}/vmlDrawing`;

const esc = (s: string): string => s
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&apos;');

interface SheetComments {
  readonly sheetNo: number;
  readonly items: readonly { readonly ref: string; readonly row: number; readonly col: number; readonly comment: CellComment }[];
}

/** Rebuild the xlsx zip with comment parts for every sheet that has comments. */
export function appendCommentsToXlsx(buf: ArrayBuffer, store: Store, sheetIds: readonly string[]): ArrayBuffer {
  const withComments: SheetComments[] = [];
  for (let index = 0; index < sheetIds.length; index += 1) {
    const id = sheetIds[index]!;
    const items: { ref: string; row: number; col: number; comment: CellComment }[] = [];
    for (const [key, cell] of store.getSheetData(id)?.getCells() ?? []) {
      if (cell.comment === undefined) continue;
      const parts = key.split(',').map(Number);
      const r = parts[0];
      const c = parts[1];
      if (r === undefined || c === undefined || !Number.isInteger(r) || !Number.isInteger(c)) continue;
      items.push({ ref: `${num2alpha(c)}${r + 1}`, row: r, col: c, comment: cell.comment });
    }
    if (items.length > 0) withComments.push({ sheetNo: index + 1, items });
  }
  if (withComments.length === 0) return buf;

  const files = safeUnzip(new Uint8Array(buf));
  const newParts: Record<string, Uint8Array> = {};
  const overrides: string[] = [];
  let partNo = 0;

  for (const sheet of withComments) {
    partNo += 1;
    const commentsPath = `xl/comments${partNo}.xml`;
    const vmlPath = `xl/drawings/vmlDrawing${partNo}.vml`;
    newParts[commentsPath] = strToU8(buildCommentsXml(sheet.items));
    newParts[vmlPath] = strToU8(buildCommentVml(sheet.items, partNo));
    overrides.push(`<Override PartName="/${commentsPath}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml"/>`);
    ensureVmlDefault(files);

    const sheetPath = `xl/worksheets/sheet${sheet.sheetNo}.xml`;
    const vmlRid = addSheetRels(files, sheetPath, [
      { ridBase: 'comments', type: REL_COMMENTS, target: `../comments${partNo}.xml` },
      { ridBase: 'vml', type: REL_VML, target: `../drawings/vmlDrawing${partNo}.vml` },
    ]);
    patchLegacyDrawing(files, sheetPath, vmlRid);
  }

  patchContentTypes(files, overrides.join(''));

  const out: Record<string, Uint8Array> = { ...files, ...newParts };
  const zipped = zipSync(out);
  return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
}

function buildCommentsXml(items: SheetComments['items']): string {
  const authors = [...new Set(items.map((i) => i.comment.author ?? ''))];
  const body = items.map((item) => {
    const authorId = Math.max(0, authors.indexOf(item.comment.author ?? ''));
    return `<comment ref="${item.ref}" authorId="${authorId}"><text><r><t xml:space="preserve">${esc(item.comment.text)}</t></r></text></comment>`;
  });
  const authorTags = authors.map((a) => `<author>${esc(a)}</author>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<comments xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><authors>${authorTags}</authors><commentList>${body.join('')}</commentList></comments>`;
}

function buildCommentVml(items: SheetComments['items'], partNo: number): string {
  const shapes = items.map((item, i) => {
    const shapeId = 1024 + partNo * 100 + i;
    return `<v:shape id="_x0000_s${shapeId}" type="#_x0000_t202" style='position:absolute;margin-left:108pt;margin-top:9pt;width:144pt;height:72pt;z-index:1;visibility:hidden' fillcolor="#ffffe1" o:insetmode="auto">`
      + `<v:fill color2="#ffffe1"/><v:shadow on="t" color="black" obscured="t"/><v:path o:connecttype="none"/>`
      + `<v:textbox style="mso-direction-alt:auto"><div style="text-align:left"></div></v:textbox>`
      + `<x:ClientData ObjectType="Note"><x:MoveWithCells/><x:SizeWithCells/><x:AutoFill>False</x:AutoFill>`
      + `<x:Row>${item.row}</x:Row><x:Column>${item.col}</x:Column></x:ClientData></v:shape>`;
  });
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">`
    + `<o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="1"/></o:shapelayout>`
    + `<v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202" path="m,l,21600r21600,l21600,21600xe"><v:stroke joinstyle="miter"/><v:path gradientshapeok="t" o:connecttype="rect"/></v:shapetype>`
    + `${shapes.join('')}</xml>`;
}

function ensureVmlDefault(files: Record<string, Uint8Array>): void {
  const part = files['[Content_Types].xml'];
  if (part === undefined) return;
  const xml = strFromU8(part);
  if (/Extension="vml"/.test(xml)) return;
  files['[Content_Types].xml'] = strToU8(xml.replace(/(<Types[^>]*>)/, `$1<Default Extension="vml" ContentType="application/vnd.openxmlformats-officedocument.vmlDrawing"/>`));
}

interface RelSpec { readonly ridBase: string; readonly type: string; readonly target: string }

/** Register comment/vml relationships on the sheet's rels; returns the vml rId. */
function addSheetRels(files: Record<string, Uint8Array>, sheetPath: string, specs: readonly RelSpec[]): string {
  const fileName = sheetPath.split('/').pop() ?? '';
  const relsPath = `xl/worksheets/_rels/${fileName}.rels`;
  const existing = files[relsPath] !== undefined ? strFromU8(files[relsPath]) : undefined;
  const used = new Set<number>([0]);
  let body = '';
  if (existing === undefined) {
    used.clear();
  } else {
    for (const m of existing.matchAll(/Id="rId(\d+)"/g)) used.add(Number(m[1]));
    body = existing.replace('</Relationships>', '');
  }
  let lastRid = '';
  for (const spec of specs) {
    let rid = 1;
    while (used.has(rid)) rid += 1;
    used.add(rid);
    body += `<Relationship Id="rId${rid}" Type="${spec.type}" Target="${spec.target}"/>`;
    lastRid = `rId${rid}`;
  }
  files[relsPath] = strToU8(`${body}</Relationships>`);
  return lastRid;
}

/** Sheet xml gains a `<legacyDrawing r:id>` child (before extLst when present). */
function patchLegacyDrawing(files: Record<string, Uint8Array>, sheetPath: string, rid: string): void {
  const part = files[sheetPath];
  if (part === undefined) return;
  let xml = strFromU8(part);
  if (/<legacyDrawing\b/.test(xml)) return;
  if (!/xmlns:r=/.test(xml)) {
    xml = xml.replace(/<worksheet\b/, `<worksheet xmlns:r="${REL_NS}"`);
  }
  const tag = `<legacyDrawing r:id="${rid}"/>`;
  if (xml.includes('<extLst>')) xml = xml.replace('<extLst>', `${tag}<extLst>`);
  else xml = xml.replace(/<\/worksheet>/, `${tag}</worksheet>`);
  files[sheetPath] = strToU8(xml);
}

function patchContentTypes(files: Record<string, Uint8Array>, overrides: string): void {
  const part = files['[Content_Types].xml'];
  if (part === undefined) return;
  const xml = strFromU8(part).replace('</Types>', `${overrides}</Types>`);
  files['[Content_Types].xml'] = strToU8(xml);
}
