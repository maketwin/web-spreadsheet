import { strFromU8, strToU8 } from 'fflate';
import * as XLSX from 'xlsx';
import type { Store } from '../store/Store';
import type { ColMeta, RichTextRun, RowMeta, Style } from '../types';
import { TOTAL_COLS, TOTAL_ROWS } from '../util/gridSize';
import { isRich } from '../util/richText';

/**
 * Style + rich-text export: SheetJS (community) writes no cell styles, so the
 * exported package's parts are patched in place — styles.xml is rebuilt from
 * the styles actually referenced by cells (interned fonts/fills/numFmts/xfs,
 * mirroring the importer's content-hash dedup) and every sheet's `<c>` elements
 * gain their `s=` index. Rich-text cells are rewritten as `t="inlineStr"` with
 * per-run `<rPr>`, which Excel reads natively and which keeps SheetJS's
 * sharedStrings untouched.
 */

const BUILT_IN_NUMFMT: Readonly<Record<string, string>> = {
  number: '#,##0.00',
  currency: '¥#,##0.00',
  percent: '0.00%',
  date: 'yyyy-mm-dd',
  time: 'hh:mm:ss',
  scientific: '0.00E+00',
};

const ARGB_OPAQUE = 'FF';

/** Style.border line name → OOXML border style ('none'/unknown maps to undefined = no line). */
const BORDER_LINE: Readonly<Record<string, 'thin' | 'thick' | 'dashed' | 'dotted'>> = {
  solid: 'thin',
  thick: 'thick',
  dashed: 'dashed',
  dotted: 'dotted',
};

const BORDER_COLOR = 'FF000000';

interface FontRef {
  readonly bold: boolean;
  readonly italic: boolean;
  readonly underline: boolean;
  readonly strike: boolean;
  readonly fontSize?: number | undefined;
  readonly fontFamily?: string | undefined;
  readonly color?: string | undefined;
}

interface XfRef {
  readonly fontId: number;
  readonly fillId: number;
  readonly numFmtId: number;
  readonly borderId: number;
  readonly align?: string | undefined;
  readonly valign?: string | undefined;
  readonly wrap: boolean;
}

/** One deduped `<border>` entry; each side absent means no line is drawn there. */
interface BorderRef {
  readonly top?: 'thin' | 'thick' | 'dashed' | 'dotted' | undefined;
  readonly bottom?: 'thin' | 'thick' | 'dashed' | 'dotted' | undefined;
  readonly left?: 'thin' | 'thick' | 'dashed' | 'dotted' | undefined;
  readonly right?: 'thin' | 'thick' | 'dashed' | 'dotted' | undefined;
}

/** One deduped `<dxf>` entry: the style a conditional-format rule applies. */
export interface DxfRef {
  readonly bold?: true | undefined;
  readonly italic?: true | undefined;
  readonly underline?: true | undefined;
  readonly strike?: true | undefined;
  readonly fontSize?: number | undefined;
  readonly color?: string | undefined;
  readonly bgcolor?: string | undefined;
}

export interface DxfTable {
  readonly items: readonly DxfRef[];
  /**
   * dxf index for a rule style, or undefined when the style carries no
   * dxf-relevant property. Only call it for the same rules collectDxfTable
   * walked (enabled formula/cellValue rules) so indices stay consistent.
   */
  readonly idOf: (style: Partial<Style>) => number | undefined;
}

interface Tables {
  readonly fonts: FontRef[];
  readonly fills: (string | undefined)[];
  readonly numFmts: Map<string, number>;
  readonly borders: BorderRef[];
  readonly dxfs: readonly DxfRef[];
  readonly xfs: XfRef[];
  /** sheetId → cell addr → xf index */
  readonly cellXfs: Map<string, Map<string, number>>;
  /** sheetId → cell addr → rich runs */
  readonly richCells: Map<string, Map<string, readonly RichTextRun[]>>;
  /** sheetId → axis styleId (col/row default) → xf index for the sheet part's style="N" */
  readonly axisXfs: Map<string, Map<string, number>>;
}

/** Patch the file table in place: rebuild styles.xml and tag styled/rich cells. */
export function applyStylesToXlsx(files: Record<string, Uint8Array>, store: Store, sheetIds: readonly string[]): void {
  const tables = collectTables(store, sheetIds);
  const hasAxisStyles = [...tables.axisXfs.values()].some((m) => m.size > 0);
  const hasStyles = tables.xfs.length > 1 || tables.richCells.size > 0 || tables.dxfs.length > 0;
  for (const [index, sheetId] of sheetIds.entries()) {
    const sheetPath = `xl/worksheets/sheet${index + 1}.xml`;
    const part = files[sheetPath];
    if (part === undefined) continue;
    let xml = strFromU8(part);
    // Column/row metadata (width, hidden, default style) shapes the worksheet
    // part even when no cell carries a style, so it is patched before the
    // styles.xml early-out below.
    const axisCols = store.getColEntries(sheetId);
    const axisRows = store.getRowEntries(sheetId);
    if (axisCols.length > 0 || axisRows.length > 0) {
      xml = patchSheetAxisMeta(xml, axisCols, axisRows, tables.axisXfs.get(sheetId)) ?? xml;
    }
    if (hasStyles) {
      const patched = patchSheetCells(xml, tables.cellXfs.get(sheetId), tables.richCells.get(sheetId));
      if (patched !== undefined) xml = patched;
    }
    if (xml !== strFromU8(part)) files[sheetPath] = strToU8(xml);
  }
  if (!hasStyles && !hasAxisStyles) return;

  files['xl/styles.xml'] = strToU8(buildStylesXml(tables));
}

/**
 * Differential formats (dxf) for conditional-format rule styles, deduped by
 * content like the importer's style interning. Shared by the styles part
 * (the `<dxfs>` table) and the sheet part (cfRule `dxfId` references).
 */
export function collectDxfTable(store: Store, sheetIds: readonly string[]): DxfTable {
  const items: DxfRef[] = [];
  const keys = new Map<string, number>();
  const idOf = (style: Partial<Style>): number | undefined => {
    const dxf: DxfRef = {
      bold: style.bold === true ? true : undefined,
      italic: style.italic === true ? true : undefined,
      underline: style.underline === true ? true : undefined,
      strike: style.strike === true ? true : undefined,
      fontSize: style.fontSize,
      color: normalizeColor(style.color),
      bgcolor: normalizeColor(style.bgcolor),
    };
    const key = JSON.stringify(dxf);
    if (key === '{}') return undefined;
    // One map lookup per rule: re-stringifying every interned item per call
    // made the walk O(cells × distinct styles).
    const found = keys.get(key);
    if (found !== undefined) return found;
    items.push(dxf);
    keys.set(key, items.length - 1);
    return items.length - 1;
  };
  for (const sheetId of sheetIds) {
    for (const [, rules] of store.getConditionalRules(sheetId)) {
      for (const rule of rules) {
        if (rule.disabled === true) continue;
        if (rule.type === 'formula' || rule.type === 'cellValue') idOf(rule.style);
      }
    }
  }
  return { items, idOf };
}

function collectTables(store: Store, sheetIds: readonly string[]): Tables {
  const fonts: FontRef[] = [{ bold: false, italic: false, underline: false, strike: false }];
  const fills: (string | undefined)[] = [undefined];
  const numFmts = new Map<string, number>();
  const borders: BorderRef[] = [{}];
  const xfs: XfRef[] = [{ fontId: 0, fillId: 0, numFmtId: 0, borderId: 0, wrap: false }];
  const dxfTable = collectDxfTable(store, sheetIds);
  const cellXfs = new Map<string, Map<string, number>>();
  const richCells = new Map<string, Map<string, readonly RichTextRun[]>>();
  const axisXfs = new Map<string, Map<string, number>>();

  // Every interning table is keyed by the item's serialized form: one map
  // lookup per cell instead of re-stringifying each interned item per call
  // (O(cells × distinct styles) before).
  const fontKeys = new Map<string, number>();
  const fontIdOf = (font: FontRef): number => {
    const key = JSON.stringify(font);
    const found = fontKeys.get(key);
    if (found !== undefined) return found;
    fonts.push(font);
    fontKeys.set(key, fonts.length - 1);
    return fonts.length - 1;
  };
  const fillIdOf = (bgcolor: string | undefined): number => {
    const found = fills.findIndex((f) => f === bgcolor);
    if (found >= 0) return found;
    fills.push(bgcolor);
    return fills.length - 1;
  };
  const numFmtIdOf = (code: string): number => {
    const existing = numFmts.get(code);
    if (existing !== undefined) return existing;
    const id = 164 + numFmts.size;
    numFmts.set(code, id);
    return id;
  };
  const borderKeys = new Map<string, number>();
  const borderIdOf = (border: Style['border']): number => {
    const ref: BorderRef = {
      top: BORDER_LINE[border?.top ?? ''],
      bottom: BORDER_LINE[border?.bottom ?? ''],
      left: BORDER_LINE[border?.left ?? ''],
      right: BORDER_LINE[border?.right ?? ''],
    };
    const key = JSON.stringify(ref);
    if (key === '{}') return 0;
    const found = borderKeys.get(key);
    if (found !== undefined) return found;
    borders.push(ref);
    borderKeys.set(key, borders.length - 1);
    return borders.length - 1;
  };
  const xfKeys = new Map<string, number>();
  const xfIdOf = (xf: XfRef): number => {
    const key = JSON.stringify(xf);
    const found = xfKeys.get(key);
    if (found !== undefined) return found;
    xfs.push(xf);
    xfKeys.set(key, xfs.length - 1);
    return xfs.length - 1;
  };
  /** One interned cellXf for a Style — shared by cells and col/row defaults. */
  const xfIdForStyle = (style: Style): number => {
    const nfCode = style.numberFormat !== undefined && style.numberFormat !== 'general'
      ? BUILT_IN_NUMFMT[style.numberFormat] ?? style.numberFormat
      : undefined;
    return xfIdOf({
      fontId: fontIdOf({
        bold: style.bold === true,
        italic: style.italic === true,
        underline: style.underline === true,
        strike: false,
        fontSize: style.fontSize,
        fontFamily: style.fontFamily,
        color: normalizeColor(style.color),
      }),
      fillId: fillIdOf(normalizeColor(style.bgcolor)),
      numFmtId: nfCode === undefined ? 0 : numFmtIdOf(nfCode),
      borderId: borderIdOf(style.border),
      align: style.align,
      valign: style.valign === 'middle' ? 'center' : style.valign,
      wrap: style.wrap === true,
    });
  };

  for (const sheetId of sheetIds) {
    const sheetXfs = new Map<string, number>();
    const sheetRich = new Map<string, readonly RichTextRun[]>();
    store.forEachCell((r, c, cell) => {
      const addr = XLSX.utils.encode_cell({ r, c });
      if (cell.formula === undefined && isRich(cell.richText)) sheetRich.set(addr, cell.richText);
      if (cell.styleId === undefined) return;
      const style = store.getStyle(cell.styleId, sheetId);
      if (style === undefined) return;
      sheetXfs.set(addr, xfIdForStyle(style));
    }, sheetId);
    if (sheetXfs.size > 0) cellXfs.set(sheetId, sheetXfs);
    if (sheetRich.size > 0) richCells.set(sheetId, sheetRich);
    // Column/row default styles intern into the same tables so the sheet
    // part's `<col style="N">` / `<row s="N">` point into cellXfs.
    const sheetAxis = new Map<string, number>();
    const internAxis = (meta: { styleId?: string | undefined }): void => {
      if (meta.styleId === undefined || sheetAxis.has(meta.styleId)) return;
      const style = store.getStyle(meta.styleId, sheetId);
      if (style !== undefined) sheetAxis.set(meta.styleId, xfIdForStyle(style));
    };
    for (const [, meta] of store.getColEntries(sheetId)) internAxis(meta);
    for (const [, meta] of store.getRowEntries(sheetId)) internAxis(meta);
    if (sheetAxis.size > 0) axisXfs.set(sheetId, sheetAxis);
  }
  return { fonts, fills, numFmts, borders, dxfs: dxfTable.items, xfs, cellXfs, richCells, axisXfs };
}

/** '#RRGGBB' → 'FFRRGGBB'; anything else passes through untouched. */
export function normalizeColor(css: string | undefined): string | undefined {
  if (css === undefined) return undefined;
  const hex = css.replace(/^#/, '');
  return /^[0-9A-Fa-f]{6}$/.test(hex) ? ARGB_OPAQUE + hex.toUpperCase() : css;
}

function buildStylesXml(tables: Tables): string {
  const numFmtXml = [...tables.numFmts.entries()]
    .map(([code, id]) => `<numFmt numFmtId="${id}" formatCode="${escapeAttr(code)}"/>`)
    .join('');
  const fontsXml = tables.fonts.map((font) => {
    let body = '';
    if (font.bold) body += '<b/>';
    if (font.italic) body += '<i/>';
    if (font.underline) body += '<u/>';
    if (font.strike) body += '<strike/>';
    body += `<sz val="${font.fontSize ?? 11}"/>`;
    if (font.color !== undefined) body += `<color rgb="${font.color}"/>`;
    body += `<name val="${escapeAttr(font.fontFamily ?? 'Calibri')}"/>`;
    return `<font>${body}</font>`;
  }).join('');
  const fillsXml = tables.fills.map((bgcolor, index) => {
    if (index === 0) return '<fill><patternFill patternType="none"/></fill>';
    if (bgcolor === undefined) return '<fill><patternFill patternType="gray125"/></fill>';
    return `<fill><patternFill patternType="solid"><fgColor rgb="${bgcolor}"/><bgColor indexed="64"/></patternFill></fill>`;
  }).join('');
  const bordersXml = tables.borders.map((border) => {
    const side = (tag: 'left' | 'right' | 'top' | 'bottom', line: BorderRef['top']): string =>
      line === undefined ? `<${tag}/>` : `<${tag} style="${line}"><color rgb="${BORDER_COLOR}"/></${tag}>`;
    return `<border>${side('left', border.left)}${side('right', border.right)}${side('top', border.top)}${side('bottom', border.bottom)}<diagonal/></border>`;
  }).join('');
  const xfsXml = tables.xfs.map((xf) => {
    const alignment = xf.align !== undefined || xf.valign !== undefined || xf.wrap
      ? `<alignment${xf.align !== undefined ? ` horizontal="${xf.align}"` : ''}${xf.valign !== undefined ? ` vertical="${xf.valign}"` : ''}${xf.wrap ? ' wrapText="1"' : ''}/>`
      : '';
    return `<xf numFmtId="${xf.numFmtId}" fontId="${xf.fontId}" fillId="${xf.fillId}" borderId="${xf.borderId}" xfId="0"`
      + `${xf.numFmtId !== 0 ? ' applyNumberFormat="1"' : ''} applyFont="1"${xf.fillId !== 0 ? ' applyFill="1"' : ''}${xf.borderId !== 0 ? ' applyBorder="1"' : ''}${alignment !== '' ? ' applyAlignment="1"' : ''}>${alignment}</xf>`;
  }).join('');
  const dxfsXml = tables.dxfs.map((dxf) => {
    let font = '';
    if (dxf.bold === true) font += '<b/>';
    if (dxf.italic === true) font += '<i/>';
    if (dxf.underline === true) font += '<u/>';
    if (dxf.strike === true) font += '<strike/>';
    if (dxf.fontSize !== undefined) font += `<sz val="${dxf.fontSize}"/>`;
    if (dxf.color !== undefined) font += `<color rgb="${dxf.color}"/>`;
    let body = '';
    if (font !== '') body += `<font>${font}</font>`;
    if (dxf.bgcolor !== undefined) body += `<fill><patternFill><bgColor rgb="${dxf.bgcolor}"/></patternFill></fill>`;
    return `<dxf>${body}</dxf>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + (numFmtXml !== '' ? `<numFmts count="${tables.numFmts.size}">${numFmtXml}</numFmts>` : '')
    + `<fonts count="${tables.fonts.length}">${fontsXml}</fonts>`
    + `<fills count="${tables.fills.length}">${fillsXml}</fills>`
    + `<borders count="${tables.borders.length}">${bordersXml}</borders>`
    + `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>`
    + `<cellXfs count="${tables.xfs.length}">${xfsXml}</cellXfs>`
    + `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>`
    + (tables.dxfs.length > 0 ? `<dxfs count="${tables.dxfs.length}">${dxfsXml}</dxfs>` : '')
    + `</styleSheet>`;
}

/**
 * One pass over every `<c>` element: add `s="xfIdx"` for styled cells and
 * rewrite rich-text cells as inline strings. Undefined when nothing changes
 * (no re-zip for plain workbooks).
 */
function patchSheetCells(xml: string, sheetXfs: Map<string, number> | undefined, sheetRich: Map<string, readonly RichTextRun[]> | undefined): string | undefined {
  if ((sheetXfs === undefined || sheetXfs.size === 0) && (sheetRich === undefined || sheetRich.size === 0)) return undefined;
  let changed = false;
  const out = xml.replace(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g, (element) => {
    const addrMatch = element.match(/\br="([A-Z]+\d+)"/);
    if (addrMatch === null) return element;
    const addr = addrMatch[1]!;
    let next = element;
    const rich = sheetRich?.get(addr);
    if (rich !== undefined) {
      next = `<c r="${addr}" t="inlineStr"><is>${rich.map(runToXml).join('')}</is></c>`;
      changed = true;
    }
    const xfIdx = sheetXfs?.get(addr);
    if (xfIdx !== undefined) {
      // SheetJS may already carry an `s=` referencing its own (replaced)
      // styles table — always overwrite with our index.
      if (/\bs="\d+"/.test(next)) next = next.replace(/\bs="\d+"/, `s="${xfIdx}"`);
      else next = next.startsWith('<c ') ? next.replace(/^<c /, `<c s="${xfIdx}" `) : next.replace(/^<c\b/, `<c s="${xfIdx}"`);
      changed = true;
    } else if (sheetXfs !== undefined && /\bs="\d+"/.test(next)) {
      // A stale SheetJS index on a cell we have no style for would point into
      // the replaced table — strip it so the default xf applies.
      next = next.replace(/\s?s="\d+"/, '');
      changed = true;
    }
    return next;
  });
  return changed ? out : undefined;
}

function runToXml(run: RichTextRun): string {
  const rpr = run.style !== undefined ? buildRPr(run.style) : '';
  return `<r>${rpr}<t xml:space="preserve">${escapeText(run.text)}</t></r>`;
}

function buildRPr(style: NonNullable<RichTextRun['style']>): string {
  let body = '';
  if (style.bold) body += '<b/>';
  if (style.italic) body += '<i/>';
  if (style.underline) body += '<u/>';
  if (style.strike) body += '<strike/>';
  if (style.fontSize !== undefined) body += `<sz val="${style.fontSize}"/>`;
  if (style.color !== undefined) {
    const rgb = normalizeColor(style.color);
    if (rgb !== undefined) body += `<color rgb="${rgb}"/>`;
  }
  if (style.fontFamily !== undefined) body += `<rFont val="${escapeAttr(style.fontFamily)}"/>`;
  if (style.vertAlign !== undefined) body += `<vertAlign val="${style.vertAlign}"/>`;
  return body !== '' ? `<rPr>${body}</rPr>` : '';
}

function escapeText(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function escapeAttr(s: string): string {
  return escapeText(s).replaceAll('"', '&quot;');
}

/**
 * Column/row metadata (width, hidden, default style) into a sheet part.
 * SheetJS's own `!cols`/`!rows` are not used for this: its community writer
 * merges adjacent same-width columns, never writes `style`, and only dresses
 * rows that hold cells — while the packed path regroups rows. Everything is
 * written from the store's axis entries instead, ascending, one `<col>` per
 * metadata column, `<row>` attributes patched onto the existing row tags
 * (or new self-closing rows for metadata-only rows). Undefined when the
 * sheet has no axis metadata to write.
 */
function patchSheetAxisMeta(
  xml: string,
  colEntries: readonly [number, ColMeta][],
  rowEntries: readonly [number, RowMeta][],
  axisXfs: Map<string, number> | undefined,
): string | undefined {
  let out = xml;
  const cols = buildColsXml(colEntries, axisXfs);
  if (cols !== undefined) {
    // `<cols>` has one fixed schema slot: immediately before `<sheetData>`.
    if (out.includes('<cols>')) out = out.replace(/<cols>[\s\S]*?<\/cols>/, cols);
    else {
      const at = out.indexOf('<sheetData');
      if (at < 0) return undefined;
      out = out.slice(0, at) + cols + out.slice(at);
    }
  }
  out = patchSheetDataRows(out, rowEntries, axisXfs);
  return out === xml ? undefined : out;
}

/** Pixels → Excel column width (max digit width 7px, 5px padding), 2 decimals like Excel writes. */
function pxToColWidth(px: number): number {
  return Math.trunc(((px - 5) / 7) * 100 + 0.5) / 100;
}

/** Pixels → row height in points (Excel: 4px per 3pt). */
function pxToRowHeight(px: number): number {
  return px * 0.75;
}

function buildColsXml(colEntries: readonly [number, ColMeta][], axisXfs: Map<string, number> | undefined): string | undefined {
  const items: string[] = [];
  for (const [c, meta] of [...colEntries].sort((a, b) => a[0] - b[0])) {
    if (c < 0 || c >= TOTAL_COLS) continue;
    let attrs = `min="${c + 1}" max="${c + 1}"`;
    if (meta.width !== undefined) attrs += ` width="${pxToColWidth(meta.width)}" customWidth="1"`;
    if (meta.hide === true) attrs += ' hidden="1"';
    const xf = meta.styleId !== undefined ? axisXfs?.get(meta.styleId) : undefined;
    if (xf !== undefined) attrs += ` style="${xf}"`;
    if (attrs !== `min="${c + 1}" max="${c + 1}"`) items.push(`<col ${attrs}/>`);
  }
  return items.length > 0 ? `<cols>${items.join('')}</cols>` : undefined;
}

/** Extra attributes a row's `<row>` open tag gains; '' when the row carries no metadata. */
function rowAttrsXml(meta: RowMeta, axisXfs: Map<string, number> | undefined): string {
  let attrs = '';
  if (meta.height !== undefined) attrs += ` ht="${pxToRowHeight(meta.height)}" customHeight="1"`;
  if (meta.hide === true) attrs += ' hidden="1"';
  const xf = meta.styleId !== undefined ? axisXfs?.get(meta.styleId) : undefined;
  if (xf !== undefined) attrs += ` s="${xf}" customFormat="1"`;
  return attrs;
}

const ROW_OPEN = /<row\b[^>]*>/g;
const ROW_NUMBER = /\br="(\d+)"/;

/** Patch `<row>` attributes inside `<sheetData>`; metadata-only rows become new self-closing rows in ascending position. */
function patchSheetDataRows(xml: string, rowEntries: readonly [number, RowMeta][], axisXfs: Map<string, number> | undefined): string {
  const wanted = new Map<number, string>();
  for (const [r, meta] of rowEntries) {
    if (r < 0 || r >= TOTAL_ROWS) continue;
    const attrs = rowAttrsXml(meta, axisXfs);
    if (attrs !== '') wanted.set(r, attrs);
  }
  if (wanted.size === 0) return xml;

  const selfClosing = xml.indexOf('<sheetData/>');
  if (selfClosing >= 0) {
    // No rows at all: every wanted row is new, ascending.
    const rows = [...wanted.entries()].sort((a, b) => a[0] - b[0])
      .map(([r, attrs]) => `<row r="${r + 1}"${attrs}/>`)
      .join('');
    return xml.slice(0, selfClosing) + `<sheetData>${rows}</sheetData>` + xml.slice(selfClosing + '<sheetData/>'.length);
  }

  const head = '<sheetData>';
  const start = xml.indexOf(head);
  const end = xml.indexOf('</sheetData>', start);
  if (start < 0 || end < start) return xml;
  const body = xml.slice(start + head.length, end);

  const pending = [...wanted.keys()].sort((a, b) => a - b);
  let pi = 0;
  const pieces: string[] = [];
  let pos = 0;
  for (const match of body.matchAll(ROW_OPEN)) {
    const tag = match[0];
    const at = match.index ?? 0;
    const idx = Number(tag.match(ROW_NUMBER)?.[1]) - 1;
    if (!Number.isInteger(idx) || idx < 0) continue;
    // New rows sorting before this one slot in ahead of it (Excel wants
    // ascending row numbers).
    while (pi < pending.length && pending[pi]! < idx) {
      const nr = pending[pi++]!;
      pieces.push(body.slice(pos, at), `<row r="${nr + 1}"${wanted.get(nr)}/>`);
      pos = at;
    }
    const extra = wanted.get(idx);
    if (extra !== undefined) {
      pi += 1; // this pending entry is patched below, not inserted
      // The open tag ends with '>' or '/>'; slide the attributes in front of it.
      pieces.push(body.slice(pos, at), tag.endsWith('/>') ? `${tag.slice(0, -2)}${extra}/>` : `${tag.slice(0, -1)}${extra}>`);
    } else {
      pieces.push(body.slice(pos, at), tag);
    }
    pos = at + tag.length;
  }
  const tail = [body.slice(pos)];
  while (pi < pending.length) {
    const nr = pending[pi++]!;
    tail.push(`<row r="${nr + 1}"${wanted.get(nr)}/>`);
  }
  return xml.slice(0, start + head.length) + pieces.join('') + tail.join('') + xml.slice(end);
}
