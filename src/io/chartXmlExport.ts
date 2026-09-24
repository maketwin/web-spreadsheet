import { zipSync, strFromU8, strToU8 } from 'fflate';
import { safeUnzip } from './safeUnzip';
import { num2alpha } from '../util/alphabet';
import type { Store } from '../store/Store';
import type { ChartSpec } from '../charts/types';

/**
 * Chart export: SheetJS cannot write drawings, so the workbook zip is
 * post-processed — per sheet with charts we add `xl/drawings/drawingN.xml`
 * (twoCellAnchor geometry, editAs="twoCell" = move & size with cells) and
 * `xl/charts/chartN.xml` (type/title/series with cached values), then wire
 * the rels and content types. Excel opens the result as native chart objects.
 */

const EMU_PER_PX = 9525;
const CHART_NS = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL_DRAWING = `${REL_NS}/drawing`;
const REL_CHART = `${REL_NS}/chart`;

const esc = (s: string): string => s
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&apos;');

/** Rebuild the xlsx zip with chart drawings for every sheet that has charts. */
export function appendChartsToXlsx(buf: ArrayBuffer, store: Store, sheetIds: readonly string[]): ArrayBuffer {
  const withCharts = sheetIds
    .map((id, index) => ({ id, sheetNo: index + 1, charts: store.getCharts(id) }))
    .filter((sheet) => sheet.charts.length > 0);
  if (withCharts.length === 0) return buf;

  const files = safeUnzip(new Uint8Array(buf));
  let drawingNo = 0;
  let chartNo = 0;
  const newParts: Record<string, Uint8Array> = {};
  const overrides: string[] = [];

  for (const sheet of withCharts) {
    drawingNo += 1;
    const drawingPath = `xl/drawings/drawing${drawingNo}.xml`;
    const sheetPath = `xl/worksheets/sheet${sheet.sheetNo}.xml`;
    const sheetName = store.getSheets().find((s) => s.id === sheet.id)?.name ?? `Sheet${sheet.sheetNo}`;

    const anchors: string[] = [];
    const chartRels: string[] = [];
    for (let i = 0; i < sheet.charts.length; i += 1) {
      const spec = sheet.charts[i]!;
      chartNo += 1;
      const rid = `rId${i + 1}`;
      chartRels.push(`<Relationship Id="${rid}" Type="${REL_CHART}" Target="../charts/chart${chartNo}.xml"/>`);
      newParts[`xl/charts/chart${chartNo}.xml`] = strToU8(buildChartXml(store, spec, sheetName));
      overrides.push(`<Override PartName="/xl/charts/chart${chartNo}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`);
      anchors.push(buildAnchorXml(spec, i + 1, rid));
    }

    newParts[drawingPath] = strToU8(buildDrawingXml(anchors));
    overrides.push(`<Override PartName="/${drawingPath}" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`);
    newParts[`xl/drawings/_rels/drawing${drawingNo}.xml.rels`] = strToU8(relsXml(chartRels.join('')));

    const drawingRid = addSheetDrawingRel(files, sheetPath, drawingPath);
    patchSheetXml(files, sheetPath, drawingRid);
  }

  patchContentTypes(files, overrides.join(''));

  const out: Record<string, Uint8Array> = { ...files, ...newParts };
  const zipped = zipSync(out);
  return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
}

function relsXml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${body}</Relationships>`;
}

/** Register the drawing on the sheet's rels (creating the rels part if absent); returns the rId. */
function addSheetDrawingRel(files: Record<string, Uint8Array>, sheetPath: string, drawingPath: string): string {
  const relsPath = `xl/worksheets/_rels/${sheetPath.split('/').pop()}.rels`;
  const existing = files[relsPath] !== undefined ? strFromU8(files[relsPath]) : undefined;
  const used = new Set<number>([0]);
  let body = '';
  if (existing === undefined) {
    used.clear();
  } else {
    for (const m of existing.matchAll(/Id="rId(\d+)"/g)) used.add(Number(m[1]));
    body = existing.replace('</Relationships>', '');
  }
  let rid = 1;
  while (used.has(rid)) rid += 1;
  body += `<Relationship Id="rId${rid}" Type="${REL_DRAWING}" Target="../${drawingPath.replace(/^xl\//, '')}"/>`;
  files[relsPath] = strToU8(`${body}</Relationships>`);
  return `rId${rid}`;
}

/** Sheet xml gains a `<drawing r:id>` child (before extLst when present). */
function patchSheetXml(files: Record<string, Uint8Array>, sheetPath: string, rid: string): void {
  const part = files[sheetPath];
  if (part === undefined) return;
  let xml = strFromU8(part);
  if (/<drawing\b/.test(xml)) return;
  // The r: prefix must be declared on the root or the part is not well-formed.
  if (!/xmlns:r=/.test(xml)) {
    xml = xml.replace(/<worksheet\b/, '<worksheet xmlns:r="' + REL_NS + '"');
  }
  const drawingTag = `<drawing r:id="${rid}"/>`;
  if (xml.includes('<extLst>')) xml = xml.replace('<extLst>', `${drawingTag}<extLst>`);
  else xml = xml.replace(/<\/worksheet>/, `${drawingTag}</worksheet>`);
  files[sheetPath] = strToU8(xml);
}

function patchContentTypes(files: Record<string, Uint8Array>, overrides: string): void {
  const part = files['[Content_Types].xml'];
  if (part === undefined) return;
  const xml = strFromU8(part).replace('</Types>', `${overrides}</Types>`);
  files['[Content_Types].xml'] = strToU8(xml);
}

function buildDrawingXml(anchors: readonly string[]): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${REL_NS}" xmlns:c="${CHART_NS}">${anchors.join('')}</xdr:wsDr>`;
}

function anchorEdgeXml(tag: string, r: number, c: number, offX: number, offY: number): string {
  return `<xdr:${tag}><xdr:col>${c}</xdr:col><xdr:colOff>${Math.round(offX * EMU_PER_PX)}</xdr:colOff><xdr:row>${r}</xdr:row><xdr:rowOff>${Math.round(offY * EMU_PER_PX)}</xdr:rowOff></xdr:${tag}>`;
}

function buildAnchorXml(spec: ChartSpec, objectIndex: number, rid: string): string {
  // Legacy anchorless specs park below/right of their data (same rule as the UI fallback).
  const anchor = spec.anchor ?? (() => {
    const end = spec.range.split(':')[1]?.split(',').map(Number) ?? [0, 0];
    const r = (end[0] ?? 0) + 1;
    const c = (end[1] ?? 0) + 1;
    return { from: { r, c, offX: 0, offY: 0 }, to: { r: r + 12, c: c + 7, offX: 0, offY: 0 } };
  })();
  return `<xdr:twoCellAnchor editAs="twoCell">`
    + `${anchorEdgeXml('from', anchor.from.r, anchor.from.c, anchor.from.offX, anchor.from.offY)}`
    + `${anchorEdgeXml('to', anchor.to.r, anchor.to.c, anchor.to.offX, anchor.to.offY)}`
    + `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${objectIndex + 1}" name="${esc(spec.title ?? `图表 ${objectIndex}`)}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>`
    + `<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>`
    + `<a:graphic><a:graphicData uri="${CHART_NS}"><c:chart xmlns:c="${CHART_NS}" r:id="${rid}"/></a:graphicData></a:graphic>`
    + `</xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`;
}

/** Minimal-but-valid chart part mirroring what readChartData renders: labels row + one series per data row. */
function buildChartXml(store: Store, spec: ChartSpec, sheetName: string): string {
  const { r1, c1, r2, c2 } = parseRange(spec.range);
  const prefix = sheetRefPrefix(sheetName);
  const q = (addr: { r: number; c: number }): string => `${prefix}$${num2alpha(addr.c)}$${addr.r + 1}`;

  const title = spec.title === undefined
    ? '<c:autoTitleDeleted val="1"/>'
    : `<c:title><c:tx><c:rich><a:bodyPr/><a:p><a:r><a:t>${esc(spec.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>`;

  const series: string[] = [];
  for (let r = r1 + 1; r <= r2; r += 1) {
    const idx = r - r1 - 1;
    const name = store.getCell(r, c1)?.text ?? `系列 ${idx + 1}`;
    const cats: string[] = [];
    const vals: string[] = [];
    for (let c = c1; c <= c2; c += 1) {
      cats.push(store.getCell(r1, c)?.text ?? '');
      const cell = store.getCell(r, c);
      vals.push(String(typeof cell?.value === 'number' ? cell.value : Number(cell?.text ?? 0)));
    }
    const numCache = `<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${vals.length}"/>${vals.map((v, i) => `<c:pt idx="${i}"><c:v>${esc(v)}</c:v></c:pt>`).join('')}</c:numCache>`;
    const strCache = `<c:strCache><c:ptCount val="${cats.length}"/>${cats.map((v, i) => `<c:pt idx="${i}"><c:v>${esc(v)}</c:v></c:pt>`).join('')}</c:strCache>`;
    series.push(`<c:ser><c:idx val="${idx}"/><c:order val="${idx}"/>`
      + `<c:tx><c:strRef><c:f>${q({ r, c: c1 })}</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${esc(name)}</c:v></c:pt></c:strCache></c:strRef></c:tx>`
      + `<c:cat><c:strRef><c:f>${q({ r: r1, c: c1 })}:${q({ r: r1, c: c2 })}</c:f>${strCache}</c:strRef></c:cat>`
      + `<c:val><c:numRef><c:f>${q({ r, c: c1 })}:${q({ r, c: c2 })}</c:f>${numCache}</c:numRef></c:val>`
      + `</c:ser>`);
  }

  const plot = spec.type === 'pie'
    ? `<c:pieChart><c:varyColors val="1"/>${series.join('')}<c:firstSliceAng val="0"/></c:pieChart>`
    : spec.type === 'line'
      ? `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${series.join('')}<c:marker val="1"/><c:axId val="100"/><c:axId val="200"/></c:lineChart>`
      : `<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>${series.join('')}<c:gapWidth val="150"/><c:axId val="100"/><c:axId val="200"/></c:barChart>`;

  const axes = spec.type === 'pie'
    ? ''
    : `<c:catAx><c:axId val="100"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="200"/></c:catAx><c:valAx><c:axId val="200"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:crossAx val="100"/></c:valAx>`;

  const legend = spec.type === 'pie' ? '<c:legend><c:legendPos val="r"/><c:overlay val="0"/></c:legend>' : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<c:chartSpace xmlns:c="${CHART_NS}" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${REL_NS}"><c:chart>${title}<c:plotArea><c:layout/>${plot}${axes}</c:plotArea>${legend}<c:plotVisOnly val="1"/></c:chart></c:chartSpace>`;
}

function parseRange(range: string): { r1: number; c1: number; r2: number; c2: number } {
  const parts = range.split(':');
  const start = parts[0]?.split(',').map(Number) ?? [0, 0];
  const end = parts[1]?.split(',').map(Number) ?? start;
  return { r1: start[0] ?? 0, c1: start[1] ?? 0, r2: end[0] ?? 0, c2: end[1] ?? 0 };
}

const PLAIN_SHEET_NAME = /^[_A-Za-z][_A-Za-z0-9]*$/;
const CELLREF_LIKE_NAME = /^[A-Za-z]{1,3}[0-9]+$/;

/**
 * A1-style sheet prefix. Excel requires single quotes around sheet names that
 * are not plain identifiers ('Q1 销售'!A1, 'A1'!B2 for cellref-like names);
 * bare names (Sheet1!A1) stay unquoted for compatibility.
 */
function sheetRefPrefix(name: string): string {
  const escaped = esc(name).replaceAll('&apos;', "''");
  return PLAIN_SHEET_NAME.test(name) && !CELLREF_LIKE_NAME.test(name) ? `${escaped}!` : `'${escaped}'!`;
}
