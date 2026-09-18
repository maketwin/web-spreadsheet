import type { ChartSpec, ChartType } from '../charts/types';
import { TOTAL_COLS, TOTAL_ROWS } from '../renderer/coordinate';
import * as XLSX from 'xlsx';

/**
 * Chart import from raw OOXML parts (zip entries exposed by SheetJS
 * `bookFiles`): `xl/drawings/drawingN.xml` two-cell anchors give the floating
 * object geometry, `xl/charts/chartN.xml` gives type/title/series ranges.
 * Regex/DOM-light parsing on purpose — the parts are small and structured.
 */

const EMU_PER_PX = 9525; // 914400 EMU/inch ÷ 96 dpi

/** All chart specs found on one worksheet (empty when the sheet has no drawing). */
export function importChartsForSheet(files: Map<string, string>, sheetPath: string): ChartSpec[] {
  const drawingPath = resolveDrawingPath(files, sheetPath);
  if (drawingPath === undefined) return [];
  const drawingXml = files.get(drawingPath);
  if (drawingXml === undefined) return [];
  const drawingRels = parseRels(files.get(relsPathFor(drawingPath)));
  const specs: ChartSpec[] = [];
  let counter = 0;
  for (const anchor of iterateAnchors(drawingXml)) {
    const chartRef = anchor.chartRid === undefined ? undefined : drawingRels.get(anchor.chartRid);
    // Rel targets are relative to the drawing part's directory (`../charts/chartN.xml`).
    const chartXml = chartRef === undefined ? undefined : files.get(resolveZipPath(drawingPath, chartRef));
    if (chartXml === undefined) continue;
    const parsed = parseChartXml(chartXml);
    if (parsed === undefined) continue;
    counter += 1;
    specs.push({
      id: `imp-chart-${counter}`,
      type: parsed.type,
      range: clampRangeToGrid(parsed.range),
      title: parsed.title,
      anchor: {
        from: clampAnchorEdge(anchor.from),
        to: clampAnchorEdge(anchor.to),
      },
    });
  }
  return specs;
}

/**
 * Crafted chart XML may reference the full 1M×16K sheet; the UI grid is
 * 1000×26. Clamping keeps readChartData's label/series loops bounded — same
 * posture as convertSheet dropping cells outside the grid.
 */
function clampRangeToGrid(range: string): string {
  const parts = range.split(':');
  const start = parts[0]?.split(',').map(Number) ?? [0, 0];
  const end = parts[1]?.split(',').map(Number) ?? start;
  const r1 = clampToGrid(start[0] ?? 0, TOTAL_ROWS - 1);
  const c1 = clampToGrid(start[1] ?? 0, TOTAL_COLS - 1);
  const r2 = clampToGrid(end[0] ?? 0, TOTAL_ROWS - 1);
  const c2 = clampToGrid(end[1] ?? 0, TOTAL_COLS - 1);
  return `${r1},${c1}:${r2},${c2}`;
}

function clampAnchorEdge(edge: { r: number; c: number; offX: number; offY: number }): { r: number; c: number; offX: number; offY: number } {
  return {
    r: clampToGrid(edge.r, TOTAL_ROWS - 1),
    c: clampToGrid(edge.c, TOTAL_COLS - 1),
    offX: edge.offX,
    offY: edge.offY,
  };
}

function clampToGrid(v: number, max: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(Math.max(0, Math.floor(v)), max);
}

interface AnchorInfo {
  readonly from: { r: number; c: number; offX: number; offY: number };
  readonly to: { r: number; c: number; offX: number; offY: number };
  readonly chartRid: string | undefined;
}

/** Sheet XML path → its drawing part path (via the sheet's rels), or undefined. */
function resolveDrawingPath(files: Map<string, string>, sheetPath: string): string | undefined {
  const rels = parseRels(files.get(relsPathFor(sheetPath)));
  for (const target of rels.values()) {
    if (target.includes('drawings/drawing')) return resolveZipPath(sheetPath, target);
  }
  return undefined;
}

/** `_rels/<basename>.rels` next to the part (OOXML convention). */
function relsPathFor(partPath: string): string {
  const slash = partPath.lastIndexOf('/');
  const dir = slash === -1 ? '' : partPath.slice(0, slash);
  const base = slash === -1 ? partPath : partPath.slice(slash + 1);
  return `${dir}/_rels/${base}.rels`;
}

/** Resolve a rel target (possibly `../`-relative) against the source part's directory. */
function resolveZipPath(fromPart: string, target: string): string {
  const clean = target.startsWith('/') ? target.slice(1) : target;
  if (!clean.startsWith('../')) return clean.startsWith('xl/') || clean.includes('/') ? clean : `xl/${clean}`;
  const slash = fromPart.lastIndexOf('/');
  let dir = slash === -1 ? '' : fromPart.slice(0, slash);
  let rest = clean;
  while (rest.startsWith('../')) {
    rest = rest.slice(3);
    dir = dir.slice(0, Math.max(dir.lastIndexOf('/'), 0)) || '';
  }
  return `${dir}/${rest}`;
}

function parseRels(relsXml: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (relsXml === undefined) return out;
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const tag = m[0];
    const id = attrOf(tag, 'Id');
    const target = attrOf(tag, 'Target');
    if (id !== undefined && target !== undefined) out.set(id, target);
  }
  return out;
}

/** Yields one entry per twoCellAnchor/oneCellAnchor that references a chart. */
function iterateAnchors(drawingXml: string): AnchorInfo[] {
  const out: AnchorInfo[] = [];
  for (const m of drawingXml.matchAll(/<(?:xdr:)?(twoCellAnchor|oneCellAnchor)\b[\s\S]*?<\/(?:xdr:)?\1>/g)) {
    const block = m[0];
    const from = parseEdge(block, 'from');
    if (from === undefined) continue;
    let to = parseEdge(block, 'to');
    if (to === undefined) {
      // oneCellAnchor: `ext cx/cy` EMU extent from the single anchor point.
      const ext = block.match(/<ext\s+cx="(\d+)"\s+cy="(\d+)"/);
      const cx = Math.round(Number(ext?.[1] ?? 0) / EMU_PER_PX);
      const cy = Math.round(Number(ext?.[2] ?? 0) / EMU_PER_PX);
      to = {
        c: from.c, r: from.r,
        offX: from.offX + cx, offY: from.offY + cy,
      };
    }
    const rid = [...block.matchAll(/<c:chart[^>]*r:id="([^"]+)"/g)][0]?.[1]
      ?? [...block.matchAll(/<c:chart[^>]*r:embed="([^"]+)"/g)][0]?.[1];
    out.push({ from, to, chartRid: rid });
  }
  return out;
}

function parseEdge(block: string, which: 'from' | 'to'): { r: number; c: number; offX: number; offY: number } | undefined {
  const m = block.match(new RegExp(`<(?:xdr:)?${which}>([\\s\\S]*?)</(?:xdr:)?${which}>`));
  if (m === null) return undefined;
  const body = m[1] ?? '';
  const col = Number(body.match(/<(?:xdr:)?col>(\d+)<\/(?:xdr:)?col>/)?.[1] ?? 0);
  const row = Number(body.match(/<(?:xdr:)?row>(\d+)<\/(?:xdr:)?row>/)?.[1] ?? 0);
  const colOff = Math.round(Number(body.match(/<(?:xdr:)?colOff>(\d+)<\/(?:xdr:)?colOff>/)?.[1] ?? 0) / EMU_PER_PX);
  const rowOff = Math.round(Number(body.match(/<(?:xdr:)?rowOff>(\d+)<\/(?:xdr:)?rowOff>/)?.[1] ?? 0) / EMU_PER_PX);
  return { r: row, c: col, offX: colOff, offY: rowOff };
}

interface ParsedChart {
  readonly type: ChartType;
  readonly range: string;
  readonly title: string | undefined;
}

export function parseChartXml(xml: string): ParsedChart | undefined {
  const type = chartTypeOf(xml);
  if (type === undefined) return undefined;
  const refs = new Set<string>();
  for (const m of xml.matchAll(/<c:f>([^<]+)<\/c:f>/g)) refs.add(m[1] ?? '');
  refs.delete('');
  const range = unionRangeOf([...refs]);
  const titleMatch = xml.match(/<c:title>[\s\S]*?<\/c:title>/);
  let title: string | undefined;
  if (titleMatch !== null) {
    const text = [...titleMatch[0].matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((t) => t[1] ?? '').join('');
    title = text.trim() === '' ? undefined : text;
  }
  return { type, range, title };
}

function chartTypeOf(xml: string): ChartType | undefined {
  if (/<c:pieChart\b/.test(xml) || /<c:doughnutChart\b/.test(xml) || /<c:ofPieChart\b/.test(xml)) return 'pie';
  if (/<c:lineChart\b/.test(xml) || /<c:areaChart\b/.test(xml) || /<c:scatterChart\b/.test(xml) || /<c:radarChart\b/.test(xml)) return 'line';
  if (/<c:barChart\b/.test(xml)) return 'bar';
  return undefined;
}

/** Union bounding box of A1-style refs (`Sheet!$B$2:$D$5`), as our `r1,c1:r2,c2` key. */
export function unionRangeOf(refs: readonly string[]): string {
  let r1 = Number.POSITIVE_INFINITY;
  let c1 = Number.POSITIVE_INFINITY;
  let r2 = -1;
  let c2 = -1;
  for (const ref of refs) {
    const span = refSpan(ref);
    if (span === undefined) continue;
    r1 = Math.min(r1, span.r1); c1 = Math.min(c1, span.c1);
    r2 = Math.max(r2, span.r2); c2 = Math.max(c2, span.c2);
  }
  if (r2 === -1) return '0,0:0,0';
  return `${r1},${c1}:${r2},${c2}`;
}

function refSpan(ref: string): { r1: number; c1: number; r2: number; c2: number } | undefined {
  // Drop the sheet prefix (handle quoted names like 'My Sheet'!A1:B2) and $ anchors.
  const bang = ref.lastIndexOf('!');
  const a1 = (bang === -1 ? ref : ref.slice(bang + 1)).replaceAll('$', '');
  const [startStr, endStr] = a1.split(':');
  if (startStr === undefined || startStr === '') return undefined;
  try {
    const start = XLSX.utils.decode_cell(startStr);
    const end = endStr !== undefined ? XLSX.utils.decode_cell(endStr) : start;
    return { r1: start.r, c1: start.c, r2: end.r, c2: end.c };
  } catch {
    return undefined;
  }
}

function attrOf(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`(?:^|\\s)${name}=(?:"([^"]*)"|'([^']*)')`));
  return m?.[1] ?? m?.[2];
}
