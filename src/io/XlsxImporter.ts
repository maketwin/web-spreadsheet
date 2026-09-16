import * as XLSX from 'xlsx';
import type { Cell, Style } from '../types';
import type { SerializedStore } from '../store/Store';
import type { SerializedSheetData } from '../store/SheetData';

/**
 * xlsx import (SheetJS based) producing a SerializedStore that
 * `Store.replaceAll` can hot-swap in. Covers multi-sheet workbooks, formulas
 * (cached value kept; the UI's formula sync recalculates), booleans, error
 * literals, dates (kept as Excel serials + number format), merged cells,
 * row heights / column widths, and cell styles (font, fill, alignment, wrap)
 * mapped from the parsed styles.xml tables.
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
  readonly fontId?: number;
  readonly fillId?: number;
  readonly alignment?: { readonly horizontal?: string; readonly vertical?: string; readonly wrapText?: boolean };
}

const ALIGN_MAP: Readonly<Record<string, NonNullable<Style['align']>>> = { left: 'left', center: 'center', right: 'right' };
const VALIGN_MAP: Readonly<Record<string, NonNullable<Style['valign']>>> = { top: 'top', center: 'middle', bottom: 'bottom' };

/** Empty worksheets still occupy a slot in SheetNames. */
export function importXlsx(buffer: ArrayBuffer): SerializedStore {
  const wb = XLSX.read(buffer, {
    type: 'array',
    cellNF: true,
    cellStyles: true,
    bookFiles: true,
    cellFormula: true,
    cellDates: false,
  });
  const tables = readStyleTables(wb);
  const files = readBookFiles(wb);
  const sheetPaths = resolveSheetPaths(files);

  const sheets = wb.SheetNames.map((name, index) => {
    const ws = wb.Sheets[name];
    const data = ws === undefined
      ? emptySheetData()
      : convertSheet(ws, tables, sheetStyleIndexes(files.get(sheetPaths.get(name) ?? '') ?? ''));
    return { id: `sheet-${index + 1}`, name, data };
  });
  if (sheets.length === 0) sheets.push({ id: 'sheet-1', name: 'Sheet1', data: emptySheetData() });
  return { activeSheetId: sheets[0]!.id, sheets };
}

function emptySheetData(): SerializedSheetData {
  return {
    cells: [], rows: [], cols: [], styles: [], merges: [],
    conditionalRules: [], charts: [], validationRules: [], sparklines: [], namedRanges: [],
  };
}

function readStyleTables(wb: XLSX.WorkBook): StyleTables {
  const styles = (wb as { Styles?: { Fonts?: FontEntry[]; Fills?: FillEntry[]; CellXf?: XfEntry[] } }).Styles;
  return { fonts: styles?.Fonts ?? [], fills: styles?.Fills ?? [], xfs: styles?.CellXf ?? [] };
}

/** bookFiles exposes the raw zip entries as `{ content }` objects (string or bytes). */
function readBookFiles(wb: XLSX.WorkBook): Map<string, string> {
  const out = new Map<string, string>();
  const files = (wb as { files?: Record<string, { content?: unknown } | string> }).files;
  if (files === undefined) return out;
  const decoder = new TextDecoder();
  for (const [path, entry] of Object.entries(files)) {
    const content = typeof entry === 'string' ? entry : entry?.content;
    if (typeof content === 'string') out.set(path, content);
    else if (content instanceof Uint8Array) out.set(path, decoder.decode(content));
  }
  return out;
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

function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`(?:^|\\s)${name.replace(':', '\\:')}=(?:"([^"]*)"|'([^']*)')`));
  return m?.[1] ?? m?.[2];
}

function decodeXmlEntities(s: string): string {
  return s.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&apos;', "'").replaceAll('&amp;', '&');
}

function convertSheet(ws: XLSX.WorkSheet, tables: StyleTables, styleIdx: Map<string, number>): SerializedSheetData {
  const data = emptySheetData();
  const cells = data.cells as Array<[string, Cell]>;
  const styles = data.styles as Array<[string, Style]>;
  const merges = data.merges as string[];
  const rows = data.rows as Array<[number, { height?: number; hide?: boolean }]>;
  const cols = data.cols as Array<[number, { width?: number; hide?: boolean }]>;
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
    const raw = ws[key] as XLSX.CellObject;
    const cell = convertCell(raw);
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
    const cell: Cell = { text: '', styleId: internStyle(style) };
    cells.push([`${r},${c}`, cell]);
  }

  for (const m of (ws as { '!merges'?: XLSX.Range[] })['!merges'] ?? []) {
    merges.push(`${XLSX.utils.encode_cell(m.s)}:${XLSX.utils.encode_cell(m.e)}`);
  }
  ((ws as { '!rows'?: Array<{ hpx?: number; hpt?: number; hidden?: boolean } | undefined> })['!rows'] ?? []).forEach((meta, r) => {
    if (meta === undefined) return;
    const rm: { height?: number; hide?: boolean } = {};
    const height = meta.hpx ?? (meta.hpt !== undefined ? Math.round(meta.hpt * 4 / 3) : undefined);
    if (height !== undefined) rm.height = height;
    if (meta.hidden === true) rm.hide = true;
    if (Object.keys(rm).length > 0) rows.push([r, rm]);
  });
  ((ws as { '!cols'?: Array<{ wch?: number; wpx?: number; hidden?: boolean } | undefined> })['!cols'] ?? []).forEach((meta, c) => {
    if (meta === undefined) return;
    const cm: { width?: number; hide?: boolean } = {};
    const width = meta.wpx ?? (meta.wch !== undefined ? Math.round(meta.wch * 7 + 5) : undefined);
    if (width !== undefined) cm.width = width;
    if (meta.hidden === true) cm.hide = true;
    if (Object.keys(cm).length > 0) cols.push([c, cm]);
  });
  return data;
}

function convertCell(raw: XLSX.CellObject): Cell {
  const cell = convertCellValue(raw);
  if (raw.f !== undefined) cell.formula = `=${raw.f}`;
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
  if (xf.alignment !== undefined) {
    const align = xf.alignment.horizontal === undefined ? undefined : ALIGN_MAP[xf.alignment.horizontal];
    if (align !== undefined) style.align = align;
    const valign = xf.alignment.vertical === undefined ? undefined : VALIGN_MAP[xf.alignment.vertical];
    if (valign !== undefined) style.valign = valign;
    if (xf.alignment.wrapText === true) style.wrap = true;
  }
  return Object.keys(style).length > 0 ? style : undefined;
}
