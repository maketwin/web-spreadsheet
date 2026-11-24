import { zipSync, strFromU8, strToU8 } from 'fflate';
import { safeUnzip } from './safeUnzip';
import * as XLSX from 'xlsx';
import type { Store } from '../store/Store';
import type { RichTextRun, Style } from '../types';
import { isRich } from '../util/richText';

/**
 * Style + rich-text export: SheetJS (community) writes no cell styles, so the
 * workbook zip is post-processed after XLSX.write — styles.xml is rebuilt from
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
}

export function appendStylesToXlsx(buf: ArrayBuffer, store: Store, sheetIds: readonly string[]): ArrayBuffer {
  const tables = collectTables(store, sheetIds);
  const hasStyles = tables.xfs.length > 1 || tables.richCells.size > 0 || tables.dxfs.length > 0;
  if (!hasStyles) return buf;

  const files = safeUnzip(new Uint8Array(buf));
  files['xl/styles.xml'] = strToU8(buildStylesXml(tables));
  for (const [index, sheetId] of sheetIds.entries()) {
    const sheetPath = `xl/worksheets/sheet${index + 1}.xml`;
    const part = files[sheetPath];
    if (part === undefined) continue;
    const patched = patchSheetCells(strFromU8(part), tables.cellXfs.get(sheetId), tables.richCells.get(sheetId));
    if (patched !== undefined) files[sheetPath] = strToU8(patched);
  }

  const zipped = zipSync(files);
  return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
}

/**
 * Differential formats (dxf) for conditional-format rule styles, deduped by
 * content like the importer's style interning. Shared by the styles part
 * (the `<dxfs>` table) and the sheet part (cfRule `dxfId` references).
 */
export function collectDxfTable(store: Store, sheetIds: readonly string[]): DxfTable {
  const items: DxfRef[] = [];
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
    const found = items.findIndex((d) => JSON.stringify(d) === key);
    if (found >= 0) return found;
    items.push(dxf);
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

  const fontIdOf = (font: FontRef): number => {
    const key = JSON.stringify(font);
    const found = fonts.findIndex((f) => JSON.stringify(f) === key);
    if (found >= 0) return found;
    fonts.push(font);
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
  const borderIdOf = (border: Style['border']): number => {
    const ref: BorderRef = {
      top: BORDER_LINE[border?.top ?? ''],
      bottom: BORDER_LINE[border?.bottom ?? ''],
      left: BORDER_LINE[border?.left ?? ''],
      right: BORDER_LINE[border?.right ?? ''],
    };
    const key = JSON.stringify(ref);
    if (key === '{}') return 0;
    const found = borders.findIndex((b) => JSON.stringify(b) === key);
    if (found >= 0) return found;
    borders.push(ref);
    return borders.length - 1;
  };
  const xfIdOf = (xf: XfRef): number => {
    const key = JSON.stringify(xf);
    const found = xfs.findIndex((f) => JSON.stringify(f) === key);
    if (found >= 0) return found;
    xfs.push(xf);
    return xfs.length - 1;
  };

  for (const sheetId of sheetIds) {
    const sheetXfs = new Map<string, number>();
    const sheetRich = new Map<string, readonly RichTextRun[]>();
    for (const [key, cell] of store.getCells(sheetId)) {
      const addr = XLSX.utils.encode_cell({ r: Number(key.split(',')[0]), c: Number(key.split(',')[1]) });
      if (cell.formula === undefined && isRich(cell.richText)) sheetRich.set(addr, cell.richText);
      if (cell.styleId === undefined) continue;
      const style = store.getStyle(cell.styleId, sheetId);
      if (style === undefined) continue;
      const nfCode = style.numberFormat !== undefined && style.numberFormat !== 'general'
        ? BUILT_IN_NUMFMT[style.numberFormat] ?? style.numberFormat
        : undefined;
      sheetXfs.set(addr, xfIdOf({
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
      }));
    }
    if (sheetXfs.size > 0) cellXfs.set(sheetId, sheetXfs);
    if (sheetRich.size > 0) richCells.set(sheetId, sheetRich);
  }
  return { fonts, fills, numFmts, borders, dxfs: dxfTable.items, xfs, cellXfs, richCells };
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
