import type { RichTextRun, RunStyle } from '../types';
import { normalizeRuns } from '../util/richText';

/**
 * Rich-text strings for xlsx import, read from the raw package XML.
 * SheetJS flattens shared-string runs into plain text, so the `<si>` runs
 * (and inlineStr cells) are parsed here — same regex style as the rest of
 * the io layer. Theme-colored runs map through a fixed Office palette
 * (theme1.xml is not parsed; tint is ignored — see the known-deviations list).
 */

export interface SharedStringEntry {
  readonly text: string;
  readonly runs?: readonly RichTextRun[];
}

/** Approximate Office clrScheme: lt1, dk1, lt2, dk2, accent1-6, hlink, folHlink. */
const THEME_COLORS: readonly string[] = ['#FFFFFF', '#000000', '#E7E6E6', '#44546A', '#4472C4', '#ED7D31', '#A5A5A5', '#FFC000', '#5B9BD5', '#70AD47', '#0563C1', '#954F72'];

/** Parse xl/sharedStrings.xml into per-index entries. */
export function parseSharedStrings(xml: string): readonly SharedStringEntry[] {
  const out: SharedStringEntry[] = [];
  if (xml === '') return out;
  for (const m of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\s*\/>/g)) {
    const body = m[1];
    out.push(body === undefined ? { text: '' } : parseSiBody(body) ?? { text: '' });
  }
  return out;
}

/**
 * Per-cell string sources of one worksheet: `A1` → shared-string index or
 * inline runs. Only `t="s"` / `t="inlineStr"` cells are reported.
 */
export function sheetStringCells(xml: string): Map<string, { shared?: number; runs?: readonly RichTextRun[] }> {
  const out = new Map<string, { shared?: number; runs?: readonly RichTextRun[] }>();
  if (xml === '') return out;
  for (const m of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const attrs = m[1] ?? '';
    const inner = m[2];
    const addr = attr(attrs, 'r');
    const t = attr(attrs, 't');
    if (addr === undefined || inner === undefined) continue;
    if (t === 's') {
      const v = inner.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
      if (v?.[1] !== undefined && /^\d+$/.test(v[1].trim())) out.set(addr, { shared: Number(v[1].trim()) });
    } else if (t === 'inlineStr') {
      const is = inner.match(/<is\b[^>]*>([\s\S]*?)<\/is>/);
      if (is?.[1] !== undefined) {
        const entry = parseSiBody(is[1]);
        if (entry !== undefined) out.set(addr, entry.runs !== undefined ? { runs: entry.runs } : {});
      }
    }
  }
  return out;
}

/** One `<si>`/`<is>` body → text (+ runs when any `<r>` carries formatting). */
function parseSiBody(rawBody: string): SharedStringEntry | undefined {
  // Phonetic (ruby) annotations ride alongside runs and must not join the text.
  const body = rawBody.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  const hasRuns = /<r\b[^>]*\/>|<r\b[^>]*>/.test(body);
  if (!hasRuns) {
    const text = decodeXmlEntities(textOf(body));
    return { text };
  }
  const runs: RichTextRun[] = [];
  const firstRun = body.search(/<r\b[^>]*\/>|<r\b[^>]*>/);
  if (firstRun > 0) {
    const lead = decodeXmlEntities(textOf(body.slice(0, firstRun)));
    if (lead !== '') runs.push({ text: lead });
  }
  for (const rm of body.matchAll(/<r\b[^>]*>([\s\S]*?)<\/r>/g)) {
    runs.push(parseRun(rm[1] ?? ''));
  }
  const flat = runs.map((run) => run.text).join('');
  const normalized = normalizeRuns(runs);
  return normalized !== undefined ? { text: flat, runs: normalized } : { text: flat };
}

function parseRun(body: string): RichTextRun {
  const text = decodeXmlEntities(textOf(body));
  const pr = body.match(/<rPr\b[^>]*(?:\/>|>[\s\S]*?<\/rPr>)/);
  const style = pr !== null ? parseRPr(pr[0]) : undefined;
  return style !== undefined && Object.keys(style).length > 0 ? { text, style } : { text };
}

function parseRPr(xml: string): RunStyle | undefined {
  const style: RunStyle = {};
  if (flagOn(xml, 'b')) style.bold = true;
  if (flagOn(xml, 'i')) style.italic = true;
  if (flagOn(xml, 'u')) style.underline = true;
  if (flagOn(xml, 'strike')) style.strike = true;
  const sz = elementAttrs(xml, 'sz');
  if (sz !== null) {
    const val = Number(attr(sz, 'val'));
    if (Number.isFinite(val) && val > 0) style.fontSize = val;
  }
  const font = elementAttrs(xml, 'rFont');
  if (font !== null) {
    const val = attr(font, 'val');
    if (val !== undefined && val !== '') style.fontFamily = val;
  }
  const color = elementAttrs(xml, 'color');
  if (color !== null) {
    const parsed = parseColor(color);
    if (parsed !== undefined) style.color = parsed;
  }
  const vert = elementAttrs(xml, 'vertAlign');
  if (vert !== null) {
    const val = attr(vert, 'val');
    if (val === 'superscript' || val === 'subscript') style.vertAlign = val;
  }
  return style;
}

/** rgb ARGB → CSS `#RRGGBB`; theme index → palette; indexed/auto → undefined. */
function parseColor(attrs: string): string | undefined {
  const rgb = attr(attrs, 'rgb');
  if (rgb !== undefined && /^[0-9A-Fa-f]{8}$/.test(rgb)) return `#${rgb.slice(2)}`;
  const theme = attr(attrs, 'theme');
  if (theme !== undefined && /^\d+$/.test(theme)) return THEME_COLORS[Number(theme)] ?? undefined;
  return undefined;
}

function flagOn(xml: string, tag: string): boolean {
  const attrs = elementAttrs(xml, tag);
  if (attrs === null) return false;
  const val = attr(attrs, 'val');
  return !(val === '0' || val === 'false' || val === 'none');
}

/** Attribute substring of a self-closing or paired element, null when absent. */
function elementAttrs(xml: string, tag: string): string | null {
  const self = xml.match(new RegExp(`<${tag}\\b([^>]*?)/>`));
  if (self !== null) return self[1] ?? '';
  const paired = xml.match(new RegExp(`<${tag}\\b([^>]*?)>`));
  if (paired !== null) return paired[1] ?? '';
  return null;
}

/** Inner text of the first `<t>` element (entities still encoded). */
function textOf(body: string): string {
  const m = body.match(/<t\b[^>]*>([\s\S]*?)<\/t>/);
  return m?.[1] ?? '';
}

function attr(attrs: string, name: string): string | undefined {
  const m = attrs.match(new RegExp(`(?:^|\\s)${name}=(?:"([^"]*)"|'([^']*)')`));
  return m?.[1] ?? m?.[2];
}

function decodeXmlEntities(s: string): string {
  return s.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&apos;', "'").replaceAll('&amp;', '&');
}
