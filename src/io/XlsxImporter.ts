import * as XLSX from 'xlsx';
import { safeUnzip } from './safeUnzip';
import { TOTAL_COLS, TOTAL_ROWS } from '../util/gridSize';
import type { AutoFilterState, Cell, Style, RichTextRun, RowMeta, ColMeta } from '../types';
import type { SerializedStore } from '../store/Store';
import type { SerializedSheetData, SheetFreeze } from '../store/SheetData';
import type { ChartSpec } from '../charts/types';
import type { CellValueOperator, ConditionalRule, IconSetName } from '../conditional/ConditionalRule';
import type { ValidationRule } from '../validation/types';
import { importChartsForSheet } from './chartXmlImport';
import { importCommentsForSheet } from './commentXmlImport';
import { parseSharedStrings, sheetStringCells, type SharedStringEntry } from './sharedStrings';
import { decodeXmlEntities } from '../util/xmlEntities';

/**
 * xlsx import (SheetJS based) producing a SerializedStore that
 * `Store.replaceAll` can hot-swap in. Covers multi-sheet workbooks, formulas
 * (cached value kept; the UI's formula sync recalculates), booleans, error
 * literals, dates (kept as Excel serials + number format), merged cells,
 * row heights / column widths, and cell styles (font, fill, alignment, wrap,
 * borders) mapped from the parsed styles.xml tables. Beyond cells/styles the
 * raw worksheet xml is parsed for freeze panes, conditional formats (dxfs),
 * data validations and the auto filter — all string/regex based because the
 * importer runs inside a Worker without DOMParser.
 */

/** Reverse of the exporter's built-in format table; anything else stays a custom format string. */
const REVERSE_NUMFMT: Readonly<Record<string, string>> = {
  '#,##0.00': 'number',
  '¥#,##0.00': 'currency',
  '0.00%': 'percent',
  'yyyy-mm-dd': 'date',
  'hh:mm:ss': 'time',
  '0.00E+00': 'scientific',
};

interface StyleTables {
  readonly fonts: readonly FontEntry[];
  readonly fills: readonly FillEntry[];
  readonly xfs: readonly XfEntry[];
  /** styles.xml `<borders>` table (borderId → mapped side line names). */
  readonly borders: readonly BorderEntry[];
  /** styles.xml `<dxfs>` (dxfId → pre-mapped conditional-format rule style). */
  readonly dxfs: readonly Partial<Style>[];
  /** styles.xml custom `<numFmt numFmtId formatCode>` table. */
  readonly numFmts: Readonly<Record<number, string>>;
}

/**
 * Excel's built-in numFmtId → format code (the subset a worksheet plausibly
 * carries). Axis styles have no cell to carry the resolved format string, so
 * their xf's numFmtId is resolved through this table or the custom one.
 */
const BUILT_IN_NUMFMT_IDS: Readonly<Record<number, string>> = {
  1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 9: '0%', 10: '0.00%', 11: '0.00E+00',
  14: 'm/d/yy', 22: 'm/d/yy h:mm', 37: '#,##0;(#,##0)', 38: '#,##0;[Red](#,##0)',
  39: '#,##0.00;(#,##0.00)', 40: '#,##0.00;[Red](#,##0.00)', 45: 'h:mm:ss', 46: 'h:mm', 47: 'h:mm:ss;@', 49: '@',
};

/** Number format a col/row xf carries: custom table first, then the built-ins. */
function numFmtCodeOf(tables: StyleTables, xfIdx: number): string | undefined {
  const id = tables.xfs[xfIdx]?.numFmtId;
  if (id === undefined || id === 0) return undefined;
  return tables.numFmts[id] ?? BUILT_IN_NUMFMT_IDS[id];
}

interface FontEntry {
  readonly bold?: boolean | number;
  readonly italic?: boolean | number;
  readonly underline?: number;
  readonly sz?: number;
  readonly name?: string;
  readonly color?: { readonly rgb?: string };
}

interface FillEntry {
  readonly patternType?: string;
  readonly fgColor?: { readonly rgb?: string };
}

interface XfEntry {
  readonly numFmtId?: number;
  readonly fontId?: number;
  readonly fillId?: number;
  readonly borderId?: number;
  readonly alignment?: { readonly horizontal?: string; readonly vertical?: string; readonly wrapText?: boolean };
}

/** Border line name of our Style model. */
type BorderLine = 'solid' | 'dashed' | 'dotted' | 'thick';

interface BorderEntry {
  readonly top?: BorderLine;
  readonly bottom?: BorderLine;
  readonly left?: BorderLine;
  readonly right?: BorderLine;
}

const ALIGN_MAP: Readonly<Record<string, NonNullable<Style['align']>>> = { left: 'left', center: 'center', right: 'right' };
const VALIGN_MAP: Readonly<Record<string, NonNullable<Style['valign']>>> = { top: 'top', center: 'middle', bottom: 'bottom' };

/**
 * Excel border line style → our line names. Solid-weight styles (thin/
 * medium/double/hair) collapse to 'solid', dash families to 'dashed';
 * colors are dropped (the model carries line names only).
 */
const BORDER_LINE_MAP: Readonly<Record<string, BorderLine>> = {
  thin: 'solid',
  medium: 'solid',
  double: 'solid',
  hair: 'solid',
  thick: 'thick',
  dashed: 'dashed',
  mediumDashed: 'dashed',
  dashDot: 'dashed',
  mediumDashDot: 'dashed',
  dashDotDot: 'dashed',
  mediumDashDotDot: 'dashed',
  slantDashDot: 'dashed',
  dotted: 'dotted',
};

/** Empty worksheets still occupy a slot in SheetNames. */
export function importXlsx(buffer: ArrayBuffer, _onWarn?: (message: string) => void): SerializedStore {
  // Unpack under the zip limits first: the SheetJS reader inflates the whole
  // package on its own, so a package bomb has to be stopped before it runs.
  const files = readZipEntries(buffer);
  const wb = XLSX.read(buffer, {
    type: 'array',
    cellNF: true,
    cellStyles: true,
    bookFiles: true,
    cellFormula: true,
    cellDates: false,
  });
  const tables = readStyleTables(wb, files.get('xl/styles.xml') ?? '');
  const sheetPaths = resolveSheetPaths(files);
  const sst = parseSharedStrings(files.get('xl/sharedStrings.xml') ?? '');

  const sheets = wb.SheetNames.map((name, index) => {
    const ws = wb.Sheets[name];
    const sheetXml = files.get(sheetPaths.get(name) ?? '') ?? '';
    const data = ws === undefined
      ? emptySheetData()
      : convertSheet(ws, tables, sheetStyleIndexes(sheetXml), sheetStringCells(sheetXml), sst, sheetXml);
    // Floating chart objects: geometry from the drawing part, type/range/title from the chart part.
    const sheetPath = sheetPaths.get(name);
    if (sheetPath !== undefined) {
      (data.charts as ChartSpec[]).push(...importChartsForSheet(files, sheetPath));
      // Comments (notes): parsed from xl/commentsN.xml via the sheet rels —
      // SheetJS's own comment reader mangles non-ASCII authors.
      importCommentsForSheet(files, sheetPath, data);
      // Freeze pane, conditional formats, data validations, auto filter: our
      // own sheet-xml parse (SheetJS exposes none of them).
      importSheetFeatures(sheetXml, ws, tables, data);
    }
    return { id: `sheet-${index + 1}`, name, data };
  });
  if (sheets.length === 0) sheets.push({ id: 'sheet-1', name: 'Sheet1', data: emptySheetData() });
  // No truncation reporting: the grid is Excel's whole address space, so a
  // legal file never exceeds it and there is nothing left out to warn about.
  // Coordinates past the space are crafted garbage and are dropped silently
  // (see convertSheet). The onWarn parameter stays for callers' signatures.
  return { activeSheetId: sheets[0]!.id, sheets };
}

function emptySheetData(): SerializedSheetData {
  return {
    cells: [], rows: [], cols: [], styles: [], merges: [],
    conditionalRules: [], charts: [], images: [], validationRules: [], sparklines: [], namedRanges: [],
    rowGroups: [],
  };
}

function readStyleTables(wb: XLSX.WorkBook, stylesXml: string): StyleTables {
  const styles = (wb as { Styles?: { Fonts?: FontEntry[]; Fills?: FillEntry[]; CellXf?: XfEntry[] } }).Styles;
  return {
    fonts: styles?.Fonts ?? [],
    fills: styles?.Fills ?? [],
    xfs: styles?.CellXf ?? [],
    borders: readBorders(stylesXml),
    dxfs: readDxfs(stylesXml),
    numFmts: readNumFmts(stylesXml),
  };
}

/** styles.xml custom formats (`numFmtId` → `formatCode`), attributes entity-decoded. */
function readNumFmts(stylesXml: string): Readonly<Record<number, string>> {
  const out: Record<number, string> = {};
  for (const el of xmlElements(stylesXml, 'numFmt')) {
    const id = Number(attr(el.head, 'numFmtId'));
    const code = attr(el.head, 'formatCode');
    if (Number.isInteger(id) && id > 0 && code !== undefined) out[id] = decodeXmlEntities(code);
  }
  return out;
}

/** One matched element: `head` is the open tag text, `body` the inner xml. */
interface XmlElement {
  readonly head: string;
  readonly body: string;
}

/** attr() is called per XML tag during import — cache one RegExp per name. */
const attrRegexCache = new Map<string, RegExp>();

function attr(tag: string, name: string): string | undefined {
  let re = attrRegexCache.get(name);
  if (re === undefined) {
    re = new RegExp(`(?:^|\\s)${name.replace(':', '\\:')}=(?:"([^"]*)"|'([^']*)')`);
    attrRegexCache.set(name, re);
  }
  const m = tag.match(re);
  return m?.[1] ?? m?.[2];
}

// decodeXmlEntities lives in src/util/xmlEntities.ts (shared with the chart
// title importer and sharedStrings — one decoder for the whole io layer).

/**
 * All `<tag …>…</tag>` / `<tag …/>` elements in document order. Namespaced
 * prefixes (`x:tag`) are tolerated; body of a self-closing element is ''.
 * elementRegexCache mirrors attrRegexCache — one RegExp per tag name.
 */
const elementRegexCache = new Map<string, RegExp>();

function xmlElements(xml: string, tag: string): readonly XmlElement[] {
  let re = elementRegexCache.get(tag);
  if (re === undefined) {
    const prefix = '(?:[A-Za-z][\\w.-]*:)?';
    re = new RegExp(`(<${prefix}${tag}\\b[^>]*?)(?:/>|>([\\s\\S]*?)</${prefix}${tag}\\s*>)`, 'g');
    elementRegexCache.set(tag, re);
  }
  const out: XmlElement[] = [];
  for (const m of xml.matchAll(re)) out.push({ head: m[1] ?? '', body: m[2] ?? '' });
  return out;
}

/** Text content of an element body: CDATA kept verbatim, tags stripped, entities resolved. */
function xmlText(body: string): string {
  let out = '';
  let rest = body;
  for (;;) {
    const m = rest.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
    if (m === null || m.index === undefined) break;
    out += plainText(rest.slice(0, m.index)) + (m[1] ?? '');
    rest = rest.slice(m.index + m[0].length);
  }
  return out + plainText(rest);
}

function plainText(xml: string): string {
  return decodeXmlEntities(xml.replace(/<[^>]*>/g, ''));
}

/** rgb ARGB of the first `<tag rgb=…>` inside body → `#RRGGBB` (alpha dropped, like the style tables). */
function rgbColorOf(body: string, tag: string): string | undefined {
  const el = xmlElements(body, tag)[0];
  return el === undefined ? undefined : hexColorOf(attr(el.head, 'rgb'));
}

function hexColorOf(rgb: string | undefined): string | undefined {
  if (rgb === undefined || !/^[0-9A-Fa-f]{6,8}$/.test(rgb)) return undefined;
  return `#${rgb.slice(-6)}`;
}

/**
 * Raw zip entries as text, decoded straight from the package bytes. SheetJS's
 * `bookFiles` hook exposes JSZip-internal entry objects without usable content,
 * so parts beyond its parser (drawings, charts, rels) are read here instead —
 * which also makes styled-but-empty cell xml visible to sheetStyleIndexes.
 */
function readZipEntries(buffer: ArrayBuffer): Map<string, string> {
  // Strict: an entry dropped for size would leave a half-read workbook, so
  // an oversized package is refused outright instead.
  const entries = safeUnzip(new Uint8Array(buffer), { oversized: 'throw' });
  const decoder = new TextDecoder();
  const out = new Map<string, string>();
  for (const [path, data] of Object.entries(entries)) {
    if (path.endsWith('/') || !isTextPart(path)) continue;
    out.set(path, decoder.decode(data));
  }
  return out;
}

/**
 * Parts the importer ever reads as text: xml (worksheet, workbook, styles,
 * shared strings, drawings, charts, comments), the relationship parts and
 * legacy VML drawings. Everything else — xl/media images, printer settings,
 * thumbnails — is skipped before decoding, so embedded binaries never
 * materialise as garbled strings alongside SheetJS's own copy.
 */
export function isTextPart(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith('.xml') || lower.endsWith('.rels') || lower.endsWith('.vml');
}

/** Map sheet name → its worksheet xml path inside the zip (via workbook rels). */
function resolveSheetPaths(files: Map<string, string>): Map<string, string> {
  const out = new Map<string, string>();
  const workbookXml = files.get('xl/workbook.xml');
  const relsXml = files.get('xl/_rels/workbook.xml.rels');
  if (workbookXml === undefined || relsXml === undefined) return out;
  const relTargets = new Map<string, string>();
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], 'Id');
    const target = attr(m[0], 'Target');
    if (id !== undefined && target !== undefined) {
      relTargets.set(id, target.startsWith('/') ? target.slice(1) : `xl/${target}`);
    }
  }
  for (const m of workbookXml.matchAll(/<sheet\b[^>]*>/g)) {
    const name = attr(m[0], 'name');
    const rid = attr(m[0], 'r:id') ?? attr(m[0], 'id');
    const target = rid === undefined ? undefined : relTargets.get(rid);
    if (name !== undefined && target !== undefined) out.set(decodeXmlEntities(name), target);
  }
  return out;
}

/** Per-cell style indexes (`<c r="B2" s="3" …>`), including styled-but-empty cells SheetJS drops. */
function sheetStyleIndexes(xml: string): Map<string, number> {
  const out = new Map<string, number>();
  if (xml === '') return out;
  for (const m of xml.matchAll(/<c\b[^>]*?>/g)) {
    const r = attr(m[0], 'r');
    const s = attr(m[0], 's');
    if (r !== undefined && s !== undefined) out.set(r, Number(s));
  }
  return out;
}

function convertSheet(ws: XLSX.WorkSheet, tables: StyleTables, styleIdx: Map<string, number>, stringCells: Map<string, { shared?: number; runs?: readonly RichTextRun[] }>, sst: readonly SharedStringEntry[], sheetXml: string): SerializedSheetData {
  const data = emptySheetData();
  const cells = data.cells as Array<[string, Cell]>;
  const styles = data.styles as Array<[string, Style]>;
  const merges = data.merges as string[];
  const rows = data.rows;
  const cols = data.cols;
  // The grid is Excel's whole address space, so a legal file never leaves it.
  // Coordinates past it (only possible in a crafted file) are dirty data:
  // skipped defensively, never warned about, and they cannot inflate the
  // workbook — each is one skipped cell.
  const inGrid = (r: number, c: number): boolean => r >= 0 && r < TOTAL_ROWS && c >= 0 && c < TOTAL_COLS;
  // Identical styles share one id (content-hash dedup) instead of one id per
  // cell — keeps serialized size proportional to distinct styles, not cells.
  const styleIds = new Map<string, string>();
  const internStyle = (style: Style): string => {
    const key = JSON.stringify(style);
    let id = styleIds.get(key);
    if (id === undefined) {
      id = `imp-s-${styleIds.size}`;
      styleIds.set(key, id);
      styles.push([id, style]);
    }
    return id;
  };
  const attachStyle = (r: number, c: number, cell: Cell, z: unknown): void => {
    const addr = XLSX.utils.encode_cell({ r, c });
    const xfIdx = styleIdx.get(addr);
    let style = xfIdx === undefined ? undefined : convertStyle(tables, xfIdx);
    // The number format travels in the style (the renderer reads style.numberFormat).
    const nf = numberFormatOf(z);
    if (nf !== undefined) style = { ...style, numberFormat: nf };
    if (style === undefined) return;
    cell.styleId = internStyle(style);
  };

  for (const key of Object.keys(ws)) {
    if (key.startsWith('!')) continue;
    const { r, c } = XLSX.utils.decode_cell(key);
    if (!inGrid(r, c)) continue;
    const raw = ws[key] as XLSX.CellObject;
    const cell = convertCell(raw);
    // Rich runs: SheetJS only exposes the flattened string, so text is taken
    // from our own parse when runs exist. Formula cells never carry them.
    const sc = stringCells.get(key);
    if (sc !== undefined && cell.formula === undefined) {
      const runs = sc.runs ?? (sc.shared !== undefined ? sst[sc.shared]?.runs : undefined);
      if (runs !== undefined) {
        cell.richText = [...runs];
        cell.text = runs.map((run) => run.text).join('');
        if (typeof cell.value === 'string') cell.value = cell.text;
      }
    }
    if (raw.t === 'n') {
      const nf = numberFormatOf(raw.z);
      cell.type = nf !== undefined && isDateFormat(nf) ? 'date' : 'number';
    }
    attachStyle(r, c, cell, raw.z);
    cells.push([`${r},${c}`, cell]);
  }
  // Styled-but-empty cells (background fills etc.) exist only in the raw xml.
  for (const [addr, xfIdx] of styleIdx) {
    if (ws[addr] !== undefined) continue;
    const style = convertStyle(tables, xfIdx);
    if (style === undefined) continue;
    const { r, c } = XLSX.utils.decode_cell(addr);
    if (!inGrid(r, c)) continue;
    const cell: Cell = { text: '', styleId: internStyle(style) };
    cells.push([`${r},${c}`, cell]);
  }
  // SheetJS can drop shared-string cells entirely (observed for sst index 0);
  // our raw t="s"/inlineStr parse is canonical, so backfill missing cells.
  for (const [addr, sc] of stringCells) {
    if (ws[addr] !== undefined) continue;
    const entry = sc.runs !== undefined
      ? { text: sc.runs.map((run) => run.text).join(''), runs: sc.runs }
      : sc.shared !== undefined ? sst[sc.shared] : undefined;
    if (entry === undefined) continue;
    const { r, c } = XLSX.utils.decode_cell(addr);
    if (!inGrid(r, c)) continue;
    const cell: Cell = { text: entry.text };
    if (entry.runs !== undefined) cell.richText = [...entry.runs];
    if (cell.text !== '') cell.value = cell.text;
    cells.push([`${r},${c}`, cell]);
  }

  for (const m of (ws as { '!merges'?: XLSX.Range[] })['!merges'] ?? []) {
    // A merge reaching past the address space would cover cells that cannot
    // exist: crafted garbage, dropped whole.
    if (m.s.r < 0 || m.s.c < 0 || m.e.r >= TOTAL_ROWS || m.e.c >= TOTAL_COLS) continue;
    merges.push(`${XLSX.utils.encode_cell(m.s)}:${XLSX.utils.encode_cell(m.e)}`);
  }
  // Row/column metadata lands in one map per axis so widths/heights (read by
  // SheetJS) and default styles (read from the raw xml below) merge on the
  // same entry, then emit ascending.
  const rowMetas = new Map<number, RowMeta>();
  const colMetas = new Map<number, ColMeta>();
  ((ws as { '!rows'?: Array<{ hpx?: number; hpt?: number; hidden?: boolean } | undefined> })['!rows'] ?? []).forEach((meta, r) => {
    if (meta === undefined) return;
    const rm: RowMeta = {};
    // `ht` is in points (OOXML); the model stores px (4px per 3pt). SheetJS
    // copies the raw value into both hpt and hpx, so hpt is the one to trust.
    const height = meta.hpt !== undefined ? Math.round(meta.hpt * 4 / 3) : meta.hpx;
    if (height !== undefined) rm.height = height;
    if (meta.hidden === true) rm.hide = true;
    if (Object.keys(rm).length > 0) rowMetas.set(r, rm);
  });
  ((ws as { '!cols'?: Array<{ width?: number; wch?: number; wpx?: number; hidden?: boolean } | undefined> })['!cols'] ?? []).forEach((meta, c) => {
    if (meta === undefined) return;
    const cm: ColMeta = {};
    // The raw `width` attribute is canonical (chars, Calibri 11: 7px digit +
    // 5px padding); SheetJS's wpx/wch are re-derived through a guessed max
    // digit width and drift off it. Hidden-only cols carry a null/NaN width.
    const width = typeof meta.width === 'number' && Number.isFinite(meta.width) && meta.width > 0
      ? Math.round(meta.width * 7 + 5)
      : meta.wpx;
    if (width !== undefined) cm.width = width;
    if (meta.hidden === true) cm.hide = true;
    if (Object.keys(cm).length > 0) colMetas.set(c, cm);
  });
  // Column default styles: `<col min max style="N">` ranges, expanded per
  // column like SheetJS expands the widths.
  for (const el of xmlElements(sheetXml, 'col')) {
    const xfIdx = Number(attr(el.head, 'style'));
    if (!Number.isInteger(xfIdx)) continue;
    const style = axisStyleOf(tables, xfIdx);
    if (style === undefined) continue;
    const min = Number(attr(el.head, 'min'));
    const max = Number(attr(el.head, 'max'));
    if (!Number.isInteger(min) || !Number.isInteger(max)) continue;
    const styleId = internStyle(style);
    for (let c = Math.max(0, min - 1); c <= Math.min(max - 1, TOTAL_COLS - 1); c += 1) {
      const meta = colMetas.get(c) ?? {};
      meta.styleId = styleId;
      colMetas.set(c, meta);
    }
  }
  // Row default styles: OOXML applies the row's `s` index (note: `s=`, unlike
  // `<col style=>`) to the whole row only when customFormat="1".
  for (const m of sheetXml.matchAll(/<row\b[^>]*>/g)) {
    if (attr(m[0], 'customFormat') !== '1') continue;
    const xfIdx = Number(attr(m[0], 's'));
    if (!Number.isInteger(xfIdx)) continue;
    const style = axisStyleOf(tables, xfIdx);
    if (style === undefined) continue;
    const r = Number(attr(m[0], 'r'));
    if (!Number.isInteger(r) || r < 1 || r > TOTAL_ROWS) continue;
    const meta = rowMetas.get(r - 1) ?? {};
    meta.styleId = internStyle(style);
    rowMetas.set(r - 1, meta);
  }
  for (const [r, rm] of [...rowMetas].sort((a, b) => a[0] - b[0])) rows.push([r, rm]);
  for (const [c, cm] of [...colMetas].sort((a, b) => a[0] - b[0])) cols.push([c, cm]);
  return data;
}

function convertCell(raw: XLSX.CellObject): Cell {
  const cell = convertCellValue(raw);
  if (raw.f !== undefined) cell.formula = `=${raw.f}`;
  const link = (raw as XLSX.CellObject & { l?: { Target?: string; Tooltip?: string } }).l;
  if (link?.Target !== undefined && link.Target !== '') {
    // SheetJS escapes `&` into the rels Target on write but reads attributes
    // raw (parsexmltag never decodes entities), so the target arrives with
    // `&amp;` still in it; internal links only carry a location, which
    // SheetJS does decode — decoding here is idempotent for those.
    const tooltip = link.Tooltip !== undefined && link.Tooltip !== ''
      ? decodeXmlEntities(link.Tooltip)
      : undefined;
    cell.hyperlink = {
      target: decodeXmlEntities(link.Target),
      ...(tooltip !== undefined ? { tooltip } : {}),
    };
  }
  return cell;
}

function convertCellValue(raw: XLSX.CellObject): Cell {
  switch (raw.t) {
    case 'n': {
      return { text: raw.w ?? String(raw.v ?? ''), value: raw.v as number };
    }
    case 'b': {
      const v = raw.v === true;
      return { text: raw.w ?? (v ? 'TRUE' : 'FALSE'), value: v, type: 'boolean' };
    }
    case 'e': {
      const err = raw.w ?? String(raw.v ?? '#VALUE!');
      return { text: err, value: err };
    }
    default: {
      const text = raw.v === null || raw.v === undefined ? '' : String(raw.v);
      const cell: Cell = { text };
      if (text !== '') cell.value = text;
      return cell;
    }
  }
}

/** Built-in name when the xlsx format matches one of ours; otherwise the raw custom string. */
function numberFormatOf(z: unknown): string | undefined {
  if (typeof z !== 'string' || z === '' || z === 'General') return undefined;
  return REVERSE_NUMFMT[z] ?? z;
}

function isDateFormat(nf: string): boolean {
  return nf === 'date' || nf === 'time' || /[ymdhs]/i.test(nf.replace(/\[[^\]]*\]/g, '').replace(/"[^"]*"/g, ''));
}

/**
 * Style of a col/row xf. Unlike a cell, an axis style has no `<v>`/`z` to
 * carry the resolved format string, so the number format is resolved from the
 * xf's numFmtId (the custom table first, then the Excel built-ins).
 */
function axisStyleOf(tables: StyleTables, xfIdx: number): Style | undefined {
  const code = numFmtCodeOf(tables, xfIdx);
  const nf = code !== undefined && code !== 'General' ? REVERSE_NUMFMT[code] ?? code : undefined;
  let style = convertStyle(tables, xfIdx);
  if (nf !== undefined) style = { ...style, numberFormat: nf };
  return style;
}

function convertStyle(tables: StyleTables, xfIdx: number): Style | undefined {
  const xf = tables.xfs[xfIdx];
  if (xf === undefined) return undefined;
  const style: Style = {};
  const font = xf.fontId === undefined ? undefined : tables.fonts[xf.fontId];
  if (font !== undefined) {
    if (font.bold) style.bold = true;
    if (font.italic) style.italic = true;
    if (font.underline !== undefined && font.underline !== 0) style.underline = true;
    if (font.sz !== undefined) style.fontSize = font.sz;
    if (font.name !== undefined) style.fontFamily = font.name;
    if (font.color?.rgb !== undefined) style.color = `#${font.color.rgb}`;
  }
  const fill = xf.fillId === undefined ? undefined : tables.fills[xf.fillId];
  if (fill?.patternType === 'solid' && fill.fgColor?.rgb !== undefined) style.bgcolor = `#${fill.fgColor.rgb}`;
  const border = xf.borderId === undefined ? undefined : tables.borders[xf.borderId];
  if (border !== undefined) {
    const b: NonNullable<Style['border']> = {};
    if (border.top !== undefined) b.top = border.top;
    if (border.bottom !== undefined) b.bottom = border.bottom;
    if (border.left !== undefined) b.left = border.left;
    if (border.right !== undefined) b.right = border.right;
    if (b.top !== undefined || b.bottom !== undefined || b.left !== undefined || b.right !== undefined) style.border = b;
  }
  if (xf.alignment !== undefined) {
    const align = xf.alignment.horizontal === undefined ? undefined : ALIGN_MAP[xf.alignment.horizontal];
    if (align !== undefined) style.align = align;
    const valign = xf.alignment.vertical === undefined ? undefined : VALIGN_MAP[xf.alignment.vertical];
    if (valign !== undefined) style.valign = valign;
    if (xf.alignment.wrapText === true) style.wrap = true;
  }
  return Object.keys(style).length > 0 ? style : undefined;
}

/** styles.xml `<borders>`: one entry per border element, sides mapped to line names (colors dropped). */
function readBorders(stylesXml: string): readonly BorderEntry[] {
  const section = xmlElements(stylesXml, 'borders')[0];
  if (section === undefined) return [];
  const out: BorderEntry[] = [];
  for (const el of xmlElements(section.body, 'border')) {
    const entry: { top?: BorderLine; bottom?: BorderLine; left?: BorderLine; right?: BorderLine } = {};
    for (const side of ['top', 'bottom', 'left', 'right'] as const) {
      const line = borderSideLine(el.body, side);
      if (line !== undefined) entry[side] = line;
    }
    out.push(entry);
  }
  return out;
}

/** style="" of one `<left>/<right>/<top>/<bottom>` side; absent or `none` → undefined. */
function borderSideLine(borderBody: string, side: string): BorderLine | undefined {
  const m = borderBody.match(new RegExp(`<(?:[A-Za-z][\\w.-]*:)?${side}\\b[^>]*>`));
  const style = m === null ? undefined : attr(m[0], 'style');
  return style === undefined ? undefined : BORDER_LINE_MAP[style];
}

/** Presence of a `<tag/>`-style flag element (val="0"/"false"/"none" means off). */
function flagOn(xml: string, tag: string): boolean {
  const m = xml.match(new RegExp(`<(?:[A-Za-z][\\w.-]*:)?${tag}\\b[^>]*>`));
  if (m === null) return false;
  const val = attr(m[0], 'val');
  return !(val === '0' || val === 'false' || val === 'none');
}

/** styles.xml `<dxfs>` → pre-mapped rule styles (dxf fills conventionally use bgColor). */
function readDxfs(stylesXml: string): readonly Partial<Style>[] {
  const section = xmlElements(stylesXml, 'dxfs')[0];
  if (section === undefined) return [];
  const out: Partial<Style>[] = [];
  for (const dxf of xmlElements(section.body, 'dxf')) {
    const style: Partial<Style> = {};
    try {
      const font = xmlElements(dxf.body, 'font')[0];
      if (font !== undefined) {
        if (flagOn(font.body, 'b')) style.bold = true;
        if (flagOn(font.body, 'i')) style.italic = true;
        if (flagOn(font.body, 'u')) style.underline = true;
        if (flagOn(font.body, 'strike')) style.strike = true;
        const color = rgbColorOf(font.body, 'color');
        if (color !== undefined) style.color = color;
      }
      const fill = xmlElements(dxf.body, 'fill')[0];
      if (fill !== undefined) {
        const bg = rgbColorOf(fill.body, 'bgColor') ?? rgbColorOf(fill.body, 'fgColor');
        if (bg !== undefined) style.bgcolor = bg;
      }
    } catch {
      // A malformed dxf stays an empty style; the import continues.
    }
    out.push(style);
  }
  return out;
}

/**
 * Worksheet-level extras beyond cells/styles — freeze pane, conditional
 * formats, data validations, auto filter — parsed from the raw sheet xml.
 * Each piece fails soft: a malformed entry is skipped, never the import.
 */
function importSheetFeatures(sheetXml: string, ws: XLSX.WorkSheet | undefined, tables: StyleTables, data: SerializedSheetData): void {
  if (sheetXml === '') return;
  const freeze = freezeOf(sheetXml);
  if (freeze !== undefined) (data as { freeze?: SheetFreeze }).freeze = freeze;
  const autoFilter = autoFilterOf(sheetXml);
  if (autoFilter !== undefined) (data as { autoFilter?: AutoFilterState }).autoFilter = autoFilter;
  importConditionalFormats(sheetXml, tables, data);
  importDataValidations(sheetXml, ws, data);
}

/** `<pane …/>` → frozen row/col counts; a "split" pane is view-only, not a freeze. */
function freezeOf(sheetXml: string): SheetFreeze | undefined {
  const pane = xmlElements(sheetXml, 'pane')[0];
  if (pane === undefined) return undefined;
  const state = attr(pane.head, 'state');
  const cols = splitCount(attr(pane.head, 'xSplit'));
  const rows = splitCount(attr(pane.head, 'ySplit'));
  const frozen = state === 'frozen' || state === 'frozenSplit' || (state === undefined && (cols > 0 || rows > 0));
  if (!frozen || (rows === 0 && cols === 0)) return undefined;
  return { rows, cols };
}

function splitCount(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** `<autoFilter ref="A1:D10"/>` → filter range with empty criteria (column filters are not imported). */
function autoFilterOf(sheetXml: string): AutoFilterState | undefined {
  const el = xmlElements(sheetXml, 'autoFilter')[0];
  if (el === undefined) return undefined;
  const rect = rectOf(attr(el.head, 'ref') ?? '');
  return rect === undefined ? undefined : { range: { r1: rect.r1, c1: rect.c1, r2: rect.r2, c2: rect.c2 }, criteria: {} };
}

/** Normalized 0-based rect. */
interface GridRect {
  readonly r1: number;
  readonly c1: number;
  readonly r2: number;
  readonly c2: number;
}

/**
 * "A1:B2" (optionally `$`-anchored / sheet-qualified) → normalized rect.
 * Undefined when unparseable or reaching past the fixed grid — rules on
 * cells that cannot exist would be dead weight.
 */
function rectOf(area: string): GridRect | undefined {
  const ref = area.trim().replace(/^(?:'[^']*'|[A-Za-z_][\w.]*)!/, '').replaceAll('$', '');
  if (ref === '') return undefined;
  let range: XLSX.Range;
  try {
    range = XLSX.utils.decode_range(ref);
  } catch {
    return undefined;
  }
  const r1 = Math.min(range.s.r, range.e.r);
  const c1 = Math.min(range.s.c, range.e.c);
  const r2 = Math.max(range.s.r, range.e.r);
  const c2 = Math.max(range.s.c, range.e.c);
  if (r1 < 0 || c1 < 0 || r2 >= TOTAL_ROWS || c2 >= TOTAL_COLS) return undefined;
  return { r1, c1, r2, c2 };
}

/** Internal rule-key format "r1,c1:r2,c2". */
function rangeKey(rect: GridRect): string {
  return `${rect.r1},${rect.c1}:${rect.r2},${rect.c2}`;
}

/** `<formula>` texts in order. */
function formulaTexts(body: string, tag: string): readonly string[] {
  return xmlElements(body, tag).map((el) => xmlText(el.body).trim());
}

const CELL_OP_MAP: Readonly<Record<string, CellValueOperator>> = {
  equal: 'eq',
  notEqual: 'neq',
  greaterThan: 'gt',
  greaterThanOrEqual: 'gte',
  lessThan: 'lt',
  lessThanOrEqual: 'lte',
  between: 'between',
};

const ICON_SET_MAP: Readonly<Record<string, IconSetName>> = {
  '3Arrows': 'arrows3',
  '3ArrowsGray': 'arrows3',
  '3TrafficLights1': 'lights3',
  '3TrafficLights2': 'lights3',
};

/** Each sqref area of a `<conditionalFormatting>` block carries the block's mapped rules. */
function importConditionalFormats(sheetXml: string, tables: StyleTables, data: SerializedSheetData): void {
  const out = data.conditionalRules as Array<[string, ConditionalRule[]]>;
  for (const block of xmlElements(sheetXml, 'conditionalFormatting')) {
    const sqref = attr(block.head, 'sqref');
    if (sqref === undefined) continue;
    const rules: ConditionalRule[] = [];
    for (const el of xmlElements(block.body, 'cfRule')) {
      try {
        const rule = convertCfRule(el, tables);
        if (rule !== undefined) rules.push(rule);
      } catch {
        // Skip the malformed rule, keep the import alive.
      }
    }
    if (rules.length === 0) continue;
    for (const area of sqref.split(/\s+/)) {
      const rect = rectOf(area);
      if (rect === undefined) continue;
      const key = rangeKey(rect);
      const existing = out.find(([k]) => k === key);
      if (existing !== undefined) existing[1].push(...rules);
      else out.push([key, [...rules]]);
    }
  }
}

function convertCfRule(el: XmlElement, tables: StyleTables): ConditionalRule | undefined {
  const type = attr(el.head, 'type');
  const style = dxfStyleOf(attr(el.head, 'dxfId'), tables);
  switch (type) {
    case 'cellIs': return cellValueRule(el, style);
    case 'containsText': return containsRule(el, style);
    case 'expression': return expressionRule(el, style);
    case 'dataBar': return dataBarRule(el);
    case 'colorScale': return colorScaleRule(el);
    case 'iconSet': return iconSetRule(el);
    default: return undefined; // aboveAverage, uniqueValues, … not in the model
  }
}

function dxfStyleOf(dxfId: string | undefined, tables: StyleTables): Partial<Style> {
  const id = Number(dxfId);
  const style = Number.isInteger(id) ? tables.dxfs[id] : undefined;
  return style === undefined ? {} : { ...style };
}

/**
 * The exporter's `contains` rule is Excel's containsText rule (the inverse
 * `notContains` operator and the beginsWith/endsWith/containsBlanks/
 * containsErrors types have no counterpart in the model). The text comes from
 * the rule's entity-encoded `text` attribute; a producer that left it out is
 * answered from the first quoted literal of the formula.
 */
function containsRule(el: XmlElement, style: Partial<Style>): ConditionalRule | undefined {
  if (attr(el.head, 'operator') === 'notContains') return undefined;
  const fromAttr = decodeXmlEntities(attr(el.head, 'text') ?? '');
  const text = fromAttr !== '' ? fromAttr : quotedFormulaLiteral(formulaTexts(el.body, 'formula')[0]);
  if (text === undefined || text === '') return undefined;
  return { type: 'cellValue', operator: 'contains', value: text, style };
}

/** First double-quoted string literal of a formula, with Excel's `""` escape undone. */
function quotedFormulaLiteral(formula: string | undefined): string | undefined {
  if (formula === undefined) return undefined;
  const m = formula.match(/"((?:[^"]|"")*)"/);
  return m === null ? undefined : m[1]!.replaceAll('""', '"');
}

function cellValueRule(el: XmlElement, style: Partial<Style>): ConditionalRule | undefined {
  const op = CELL_OP_MAP[attr(el.head, 'operator') ?? ''];
  if (op === undefined) return undefined; // notBetween has no inverse in the model
  const formulas = formulaTexts(el.body, 'formula');
  if (formulas.length === 0) return undefined;
  if (op === 'between') {
    if (formulas.length < 2) return undefined;
    return { type: 'cellValue', operator: 'between', value: ruleValue(formulas[0]!), value2: ruleValue(formulas[1]!), style };
  }
  return { type: 'cellValue', operator: op, value: ruleValue(formulas[0]!), style };
}

/** A bare decimal number in the rule — Excel writes numeric criteria without quotes. */
const NUMERIC_CRITERION = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * A cellIs operand: a number when Excel wrote one bare, otherwise the text
 * without the quotes Excel wraps text criteria in (`"abc"` → `abc`).
 */
function ruleValue(text: string): string | number {
  if (NUMERIC_CRITERION.test(text)) return Number(text);
  const quoted = text.match(/^"([\s\S]*)"$/);
  return quoted !== null ? quoted[1]!.replaceAll('""', '"') : text;
}

function expressionRule(el: XmlElement, style: Partial<Style>): ConditionalRule | undefined {
  const f = formulaTexts(el.body, 'formula')[0];
  if (f === undefined || f === '') return undefined;
  return { type: 'formula', formula: `=${f}`, style };
}

function dataBarRule(el: XmlElement): ConditionalRule | undefined {
  const bar = xmlElements(el.body, 'dataBar')[0];
  if (bar === undefined) return undefined;
  const color = rgbColorOf(bar.body, 'color');
  if (color === undefined) return undefined;
  const cfvos = xmlElements(bar.body, 'cfvo').map(cfvoBound);
  return { type: 'dataBar', min: cfvos[0] ?? 0, max: cfvos[1] ?? 100, color };
}

function colorScaleRule(el: XmlElement): ConditionalRule | undefined {
  const cs = xmlElements(el.body, 'colorScale')[0];
  if (cs === undefined) return undefined;
  const cfvos = xmlElements(cs.body, 'cfvo').map(cfvoBound);
  const colors = xmlElements(cs.body, 'color')
    .map((c) => hexColorOf(attr(c.head, 'rgb')))
    .filter((c): c is string => c !== undefined);
  const minColor = colors[0];
  const maxColor = colors[colors.length - 1];
  if (minColor === undefined || maxColor === undefined) return undefined;
  return { type: 'colorScale', min: cfvos[0] ?? 0, max: cfvos[cfvos.length - 1] ?? 100, minColor, maxColor };
}

function iconSetRule(el: XmlElement): ConditionalRule | undefined {
  const is = xmlElements(el.body, 'iconSet')[0];
  if (is === undefined) return undefined;
  const icons = ICON_SET_MAP[attr(is.head, 'iconSet') ?? '3TrafficLights1'];
  if (icons === undefined) return undefined; // 4-/5-icon sets have no counterpart
  // Excel cfvo: [floor, low, high]; our thresholds are [high, low].
  const cfvos = xmlElements(is.body, 'cfvo');
  const low = iconThreshold(cfvos[1]);
  const high = iconThreshold(cfvos[2]);
  const numBasis = low !== undefined && high !== undefined && low.basis === 'num' && high.basis === 'num';
  return {
    type: 'iconSet',
    icons,
    ...(low !== undefined && high !== undefined ? { thresholds: [high.value, low.value] as const } : {}),
    ...(numBasis ? { basis: 'num' as const } : {}),
  };
}

function iconThreshold(el: XmlElement | undefined): { value: number; basis: 'percent' | 'num' } | undefined {
  if (el === undefined) return undefined;
  const val = Number(attr(el.head, 'val'));
  if (!Number.isFinite(val)) return undefined;
  return { value: val, basis: attr(el.head, 'type') === 'num' ? 'num' : 'percent' };
}

/** cfvo → static bound: num/percent val; min→0, max→100 (the app's static scale). */
function cfvoBound(el: XmlElement): number | undefined {
  const type = attr(el.head, 'type');
  if (type === 'min') return 0;
  if (type === 'max') return 100;
  const val = Number(attr(el.head, 'val'));
  return Number.isFinite(val) ? val : undefined;
}

/** Each sqref area of a `<dataValidation>` gets its own mapped rule entry. */
function importDataValidations(sheetXml: string, ws: XLSX.WorkSheet | undefined, data: SerializedSheetData): void {
  const out = data.validationRules as Array<[string, ValidationRule]>;
  for (const block of xmlElements(sheetXml, 'dataValidations')) {
    for (const el of xmlElements(block.body, 'dataValidation')) {
      const type = attr(el.head, 'type');
      const sqref = attr(el.head, 'sqref');
      if (type === undefined || sqref === undefined) continue;
      let rule: ValidationRule | undefined;
      try {
        rule = convertValidationRule(type, attr(el.head, 'operator'), el.body, ws);
      } catch {
        rule = undefined;
      }
      if (rule === undefined) continue;
      for (const area of sqref.split(/\s+/)) {
        const rect = rectOf(area);
        if (rect === undefined) continue;
        out.push([rangeKey(rect), rule]);
      }
    }
  }
}

/** Loosest bound standing in for the absent side of a one-sided operator (JSON-safe number). */
const NO_BOUND = Number.MAX_SAFE_INTEGER;
const DATE_MIN = '1899-12-30'; // Excel serial 0

function convertValidationRule(type: string, operator: string | undefined, body: string, ws: XLSX.WorkSheet | undefined): ValidationRule | undefined {
  switch (type) {
    case 'list': {
      const values = listValuesOf(formulaTexts(body, 'formula1')[0], ws);
      return values === undefined ? undefined : { type: 'list', values };
    }
    case 'whole':
    case 'decimal':
    case 'textLength': {
      const bounds = numericBounds(operator, formulaTexts(body, 'formula1')[0], formulaTexts(body, 'formula2')[0]);
      if (bounds === undefined) return undefined;
      if (type === 'whole') return { type: 'integer', min: bounds.min, max: bounds.max };
      if (type === 'decimal') return { type: 'decimal', min: bounds.min, max: bounds.max };
      return { type: 'textLength', min: bounds.min, max: bounds.max };
    }
    case 'date': {
      const bounds = dateBounds(operator, formulaTexts(body, 'formula1')[0], formulaTexts(body, 'formula2')[0]);
      return bounds === undefined ? undefined : { type: 'date', minDate: bounds.min, maxDate: bounds.max };
    }
    case 'custom': {
      const f = formulaTexts(body, 'formula1')[0];
      if (f === undefined || f === '') return undefined;
      return { type: 'custom', formula: `=${f}` };
    }
    default:
      return undefined; // time / no type — not in the model
  }
}

function numericBounds(operator: string | undefined, f1: string | undefined, f2: string | undefined): { min: number; max: number } | undefined {
  const a = Number(f1);
  const b = Number(f2);
  switch (operator ?? 'between') {
    case 'between':
      // Excel writes both formulas; with only one, degenerate to an exact match.
      if (!Number.isFinite(a)) return undefined;
      return Number.isFinite(b) ? { min: Math.min(a, b), max: Math.max(a, b) } : { min: a, max: a };
    case 'greaterThanOrEqual':
    case 'greaterThan':
      return Number.isFinite(a) ? { min: a, max: NO_BOUND } : undefined;
    case 'lessThanOrEqual':
    case 'lessThan':
      return Number.isFinite(a) ? { min: -NO_BOUND, max: a } : undefined;
    case 'equal':
      return Number.isFinite(a) ? { min: a, max: a } : undefined;
    default:
      return undefined; // notEqual / notBetween: no range counterpart in the model
  }
}

function dateBounds(operator: string | undefined, f1: string | undefined, f2: string | undefined): { min: string; max: string } | undefined {
  const a = excelDateText(f1);
  const b = excelDateText(f2);
  switch (operator ?? 'between') {
    case 'between':
      if (a === undefined) return undefined;
      return b !== undefined ? { min: a < b ? a : b, max: a < b ? b : a } : { min: a, max: a };
    case 'greaterThanOrEqual':
    case 'greaterThan':
      return a !== undefined ? { min: a, max: '9999-12-31' } : undefined;
    case 'lessThanOrEqual':
    case 'lessThan':
      return a !== undefined ? { min: DATE_MIN, max: a } : undefined;
    case 'equal':
      return a !== undefined ? { min: a, max: a } : undefined;
    default:
      return undefined;
  }
}

/** Excel date serial → 'YYYY-MM-DD' (serial 0 = 1899-12-30); ISO text passes through. */
function excelDateText(f: string | undefined): string | undefined {
  if (f === undefined) return undefined;
  const t = f.trim();
  if (t === '') return undefined;
  const n = Number(t);
  if (Number.isFinite(n)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000);
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return `${d.getUTCFullYear()}-${mm}-${dd}`;
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : undefined;
}

/** Inline list `"a,b,c"` — or a range reference expanded from SheetJS-read cell values. */
function listValuesOf(f1: string | undefined, ws: XLSX.WorkSheet | undefined): readonly string[] | undefined {
  if (f1 === undefined) return undefined;
  const t = f1.trim();
  const inline = t.match(/^"([\s\S]*)"$/);
  if (inline !== null) {
    const values = (inline[1] ?? '').replaceAll('""', '"').split(',').map((s) => s.trim()).filter((s) => s !== '');
    return values.length > 0 ? values : undefined;
  }
  const rect = rectOf(t);
  if (rect === undefined || ws === undefined) return undefined;
  // Stored cells only: the range is answered by filtering the worksheet's
  // real cell keys — the rectangle itself is never walked (a list sourced
  // from a whole-column reference costs the file, not the range).
  const hits: Array<{ r: number; c: number; text: string }> = [];
  for (const key of Object.keys(ws)) {
    if (key.startsWith('!')) continue;
    const { r, c } = XLSX.utils.decode_cell(key);
    if (r < rect.r1 || r > rect.r2 || c < rect.c1 || c > rect.c2) continue;
    const cell = ws[key] as XLSX.CellObject;
    const text = cell?.w ?? (cell?.v === undefined || cell?.v === null ? undefined : String(cell.v));
    if (typeof text === 'string' && text.trim() !== '') hits.push({ r, c, text: text.trim() });
  }
  // Row-major order, matching what a range walk would have read.
  hits.sort((a, b) => a.r - b.r || a.c - b.c);
  return hits.length > 0 ? hits.map((hit) => hit.text) : undefined;
}
