import { zipSync, strFromU8, strToU8 } from 'fflate';
import { safeUnzip } from './safeUnzip';
import * as XLSX from 'xlsx';
import type { Store } from '../store/Store';
import type { SheetFreeze } from '../store/SheetData';
import type { Style } from '../types';
import type { CellValueOperator, ConditionalRule, IconSetName } from '../conditional/ConditionalRule';
import type { ValidationRule } from '../validation/types';
import { collectDxfTable, normalizeColor } from './styleXmlExport';

/**
 * Sheet-feature export (freeze panes, conditional formatting, data
 * validations, autofilter): SheetJS (community) writes none of these, so the
 * workbook zip is post-processed and each sheet gains the worksheet children
 * the store carries. New children are merged into the sheet XML following the
 * ECMA-376 CT_Worksheet element sequence — Excel rejects out-of-order parts —
 * so they land before the `<drawing>`/`<legacyDrawing>` elements that the
 * chart/comment post-processing appends afterwards.
 */

/** ECMA-376 CT_Worksheet child sequence (sheetPr … extLst). */
const WORKSHEET_ORDER: readonly string[] = [
  'sheetPr', 'dimension', 'sheetViews', 'sheetFormatPr', 'cols', 'sheetData',
  'sheetCalcPr', 'sheetProtection', 'protectedRanges', 'scenarios', 'autoFilter',
  'sortState', 'dataConsolidate', 'customSheetViews', 'mergeCells', 'phoneticPr',
  'conditionalFormatting', 'dataValidations', 'hyperlinks', 'printOptions',
  'pageMargins', 'pageSetup', 'headerFooter', 'rowBreaks', 'colBreaks',
  'customProperties', 'cellWatches', 'ignoredErrors', 'smartTags', 'drawing',
  'legacyDrawing', 'legacyDrawingHF', 'picture', 'oleObjects', 'controls',
  'webPublishItems', 'tableParts', 'extLst',
];

const CELL_VALUE_OPERATOR: Readonly<Record<CellValueOperator, string>> = {
  eq: 'equal',
  neq: 'notEqual',
  gt: 'greaterThan',
  gte: 'greaterThanOrEqual',
  lt: 'lessThan',
  lte: 'lessThanOrEqual',
  between: 'between',
  contains: 'containsText',
};

const ICON_SET_NAME: Readonly<Record<IconSetName, string>> = {
  arrows3: '3Arrows',
  lights3: '3TrafficLights1',
};

/** Black ARGB for rule colors the normalizer cannot parse. */
const FALLBACK_ARGB = 'FF000000';

/** One worksheet-level element waiting to be merged into a sheet part. */
interface WorksheetElement {
  readonly tag: string;
  readonly xml: string;
}

interface SheetPatch {
  readonly freeze?: SheetFreeze | undefined;
  readonly elements: readonly WorksheetElement[];
}

/** Rebuild the xlsx zip with freeze panes / autofilter / conditional formats / validations. */
export function appendSheetFeaturesToXlsx(buf: ArrayBuffer, store: Store, sheetIds: readonly string[]): ArrayBuffer {
  const dxfIdOf = collectDxfTable(store, sheetIds).idOf;
  const patches = new Map<number, SheetPatch>();

  for (const [index, sheetId] of sheetIds.entries()) {
    const elements: WorksheetElement[] = [];

    const filter = store.getAutoFilter(sheetId);
    if (filter !== undefined) {
      elements.push({ tag: 'autoFilter', xml: `<autoFilter ref="${a1Range(filter.range)}"/>` });
    }
    elements.push(...buildConditionalFormattingXml(store, sheetId, dxfIdOf));
    elements.push(...buildDataValidationsXml(store, sheetId));

    const freeze = store.getFreeze(sheetId);
    const hasFreeze = freeze !== undefined && (freeze.rows > 0 || freeze.cols > 0);
    if (elements.length === 0 && !hasFreeze) continue;
    patches.set(index, { freeze: hasFreeze ? freeze : undefined, elements });
  }
  if (patches.size === 0) return buf;

  const files = safeUnzip(new Uint8Array(buf));
  for (const [index, patch] of patches) {
    const sheetPath = `xl/worksheets/sheet${index + 1}.xml`;
    const part = files[sheetPath];
    if (part === undefined) continue;
    let xml = strFromU8(part);
    if (patch.elements.length > 0) xml = insertWorksheetElements(xml, patch.elements);
    if (patch.freeze !== undefined) xml = patchFreezePane(xml, patch.freeze);
    files[sheetPath] = strToU8(xml);
  }

  const zipped = zipSync(files);
  return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
}

/**
 * Merge worksheet-level elements into the sheet XML at their CT_Worksheet
 * positions: existing top-level children are re-emitted unchanged (in their
 * current relative order), the new elements slotted in between them by
 * schema index, before `</worksheet>`.
 */
function insertWorksheetElements(xml: string, elements: readonly WorksheetElement[]): string {
  const open = xml.match(/<worksheet\b[^>]*>/);
  if (open === null || open.index === undefined) return xml;
  const headEnd = open.index + open[0].length;
  const tailStart = xml.lastIndexOf('</worksheet>');
  if (tailStart < headEnd) return xml;
  const prefix = xml.slice(0, open.index);
  const tail = xml.slice(tailStart);
  const body = xml.slice(headEnd, tailStart);

  interface Child { readonly tag: string; readonly text: string; readonly order: number; readonly tie: number }
  const children: Child[] = [];
  // Top-level children only: each match swallows a whole element (including
  // nested content up to its own closing tag), so scanning resumes past it.
  const childRe = /<([A-Za-z][A-Za-z0-9]*)\b[^>]*?(?:\/>|>[\s\S]*?<\/\1>)/g;
  let pos = 0;
  let tie = 0;
  for (const match of body.matchAll(childRe)) {
    const start = match.index ?? 0;
    // Inter-element gaps (whitespace) ride along with the following child.
    const text = body.slice(pos, start) + match[0];
    pos = start + match[0].length;
    children.push({ tag: match[1] ?? '', text, order: worksheetOrder(match[1] ?? ''), tie });
    tie += 1;
  }
  if (pos < body.length) children.push({ tag: '', text: body.slice(pos), order: Number.MAX_SAFE_INTEGER, tie });

  const merged = [
    ...children,
    ...elements.map((element, i) => ({ tag: element.tag, text: element.xml, order: worksheetOrder(element.tag), tie: tie + 1 + i })),
  ];
  merged.sort((a, b) => a.order - b.order || a.tie - b.tie);
  return prefix + open[0] + merged.map((child) => child.text).join('') + tail;
}

function worksheetOrder(tag: string): number {
  const index = WORKSHEET_ORDER.indexOf(tag);
  return index >= 0 ? index : Number.MAX_SAFE_INTEGER;
}

/** Sheet xml's `<sheetView>` gains a frozen `<pane>` as its first child. */
function patchFreezePane(xml: string, freeze: SheetFreeze): string {
  const pane = buildPaneXml(freeze);
  const selfClosing = xml.match(/<sheetView\b[^>]*\/>/);
  if (selfClosing !== null) {
    // SheetJS emits <sheetView workbookViewId="0"/> — open it up.
    const opened = `${selfClosing[0].slice(0, -2)}>${pane}</sheetView>`;
    return xml.replace(selfClosing[0], () => opened);
  }
  const open = xml.match(/<sheetView\b[^>]*>/);
  if (open !== null) return xml.replace(open[0], () => `${open[0]}${pane}`);
  // No sheetViews at all: add one in its schema position.
  return insertWorksheetElements(xml, [
    { tag: 'sheetViews', xml: `<sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews>` },
  ]);
}

function buildPaneXml(freeze: SheetFreeze): string {
  const attrs: string[] = [];
  if (freeze.cols > 0) attrs.push(`xSplit="${freeze.cols}"`);
  if (freeze.rows > 0) attrs.push(`ySplit="${freeze.rows}"`);
  attrs.push(`topLeftCell="${XLSX.utils.encode_cell({ r: freeze.rows, c: freeze.cols })}"`);
  const activePane = freeze.rows > 0 ? (freeze.cols > 0 ? 'bottomRight' : 'bottomLeft') : 'topRight';
  attrs.push(`activePane="${activePane}"`, 'state="frozen"');
  return `<pane ${attrs.join(' ')}/>`;
}

function buildConditionalFormattingXml(
  store: Store,
  sheetId: string,
  dxfIdOf: (style: Partial<Style>) => number | undefined,
): WorksheetElement[] {
  const out: WorksheetElement[] = [];
  // Rule precedence is sheet-wide: Excel expects unique ascending priorities.
  let priority = 0;
  for (const [rangeKey, rules] of store.getConditionalRules(sheetId)) {
    const range = parseRangeKey(rangeKey);
    const sqref = a1Range(range);
    const topLeft = XLSX.utils.encode_cell({ r: range.r1, c: range.c1 });
    const ruleXml = rules
      .filter((rule) => rule.disabled !== true)
      .map((rule) => cfRuleXml(rule, priority += 1, topLeft, dxfIdOf))
      .filter((xml) => xml !== undefined);
    if (ruleXml.length > 0) {
      out.push({ tag: 'conditionalFormatting', xml: `<conditionalFormatting sqref="${escapeAttr(sqref)}">${ruleXml.join('')}</conditionalFormatting>` });
    }
  }
  return out;
}

function cfRuleXml(
  rule: ConditionalRule,
  priority: number,
  topLeft: string,
  dxfIdOf: (style: Partial<Style>) => number | undefined,
): string | undefined {
  switch (rule.type) {
    case 'cellValue': {
      const dxfId = dxfIdOf(rule.style);
      const dxfAttr = dxfId !== undefined ? ` dxfId="${dxfId}"` : '';
      if (rule.operator === 'contains') {
        const text = String(rule.value);
        const formula = `NOT(ISERROR(SEARCH("${text.replaceAll('"', '""')}",${topLeft})))`;
        return `<cfRule type="containsText"${dxfAttr} priority="${priority}" operator="containsText" text="${escapeAttr(text)}"><formula>${escapeText(formula)}</formula></cfRule>`;
      }
      const formulas = `<formula>${escapeText(formulaLiteral(rule.value))}</formula>`
        + (rule.operator === 'between' ? `<formula>${escapeText(formulaLiteral(rule.value2 ?? rule.value))}</formula>` : '');
      return `<cfRule type="cellIs"${dxfAttr} priority="${priority}" operator="${CELL_VALUE_OPERATOR[rule.operator]}">${formulas}</cfRule>`;
    }
    case 'formula': {
      const dxfId = dxfIdOf(rule.style);
      const dxfAttr = dxfId !== undefined ? ` dxfId="${dxfId}"` : '';
      // Excel evaluates relative references against the range's top-left cell.
      return `<cfRule type="expression"${dxfAttr} priority="${priority}"><formula>${escapeText(rule.formula.replace(/^=/, ''))}</formula></cfRule>`;
    }
    case 'dataBar':
      return `<cfRule type="dataBar" priority="${priority}"><dataBar>`
        + `<cfvo type="num" val="${rule.min}"/><cfvo type="num" val="${rule.max}"/>`
        + `<color rgb="${normalizeColor(rule.color) ?? FALLBACK_ARGB}"/>`
        + `</dataBar></cfRule>`;
    case 'colorScale':
      return `<cfRule type="colorScale" priority="${priority}"><colorScale>`
        + `<cfvo type="num" val="${rule.min}"/><cfvo type="num" val="${rule.max}"/>`
        + `<color rgb="${normalizeColor(rule.minColor) ?? FALLBACK_ARGB}"/>`
        + `<color rgb="${normalizeColor(rule.maxColor) ?? FALLBACK_ARGB}"/>`
        + `</colorScale></cfRule>`;
    case 'iconSet': {
      // Thresholds are [high, low]; cfvo order is ascending (min, low, high).
      const [high, low] = rule.thresholds ?? [67, 33];
      const type = rule.basis === 'num' ? 'num' : 'percent';
      const base = rule.basis === 'num' ? '<cfvo type="min"/>' : '<cfvo type="percent" val="0"/>';
      return `<cfRule type="iconSet" priority="${priority}"><iconSet iconSet="${ICON_SET_NAME[rule.icons]}">`
        + `${base}<cfvo type="${type}" val="${low}"/><cfvo type="${type}" val="${high}"/>`
        + `</iconSet></cfRule>`;
    }
  }
}

function buildDataValidationsXml(store: Store, sheetId: string): WorksheetElement[] {
  const items: string[] = [];
  for (const [rangeKey, rule] of store.getValidationRules(sheetId)) {
    const sqref = a1Range(parseRangeKey(rangeKey));
    const xml = dataValidationXml(rule, sqref);
    if (xml !== undefined) items.push(xml);
  }
  if (items.length === 0) return [];
  return [{
    tag: 'dataValidations',
    xml: `<dataValidations count="${items.length}">${items.join('')}</dataValidations>`,
  }];
}

function dataValidationXml(rule: ValidationRule, sqref: string): string | undefined {
  const head = ` allowBlank="1" showErrorMessage="1" sqref="${escapeAttr(sqref)}"`;
  switch (rule.type) {
    case 'list': {
      // Excel list literal: comma-joined, quoted as a whole; embedded quotes doubled.
      const items = rule.values.map((value) => value.replaceAll('"', '""')).join(',');
      return `<dataValidation type="list"${head}><formula1>${escapeText(`"${items}"`)}</formula1></dataValidation>`;
    }
    case 'custom':
      return `<dataValidation type="custom"${head}><formula1>${escapeText(rule.formula.replace(/^=/, ''))}</formula1></dataValidation>`;
    case 'date': {
      const min = dateSerial(rule.minDate);
      const max = dateSerial(rule.maxDate);
      if (min === undefined || max === undefined) return undefined;
      return `<dataValidation type="date" operator="between"${head}><formula1>${min}</formula1><formula2>${max}</formula2></dataValidation>`;
    }
    case 'integer':
    case 'decimal':
    case 'textLength': {
      const type = rule.type === 'integer' ? 'whole' : rule.type;
      if (rule.min !== undefined && rule.max !== undefined) {
        return `<dataValidation type="${type}" operator="between"${head}><formula1>${rule.min}</formula1><formula2>${rule.max}</formula2></dataValidation>`;
      }
      if (rule.min !== undefined) {
        return `<dataValidation type="${type}" operator="greaterThanOrEqual"${head}><formula1>${rule.min}</formula1></dataValidation>`;
      }
      if (rule.max !== undefined) {
        return `<dataValidation type="${type}" operator="lessThanOrEqual"${head}><formula1>${rule.max}</formula1></dataValidation>`;
      }
      return undefined;
    }
  }
}

/** A bare decimal number — what Excel compares numerically in a cellIs rule. */
const NUMERIC_CRITERION = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * A cellIs comparison operand. The app keeps its criteria as text (`"20"`),
 * but Excel only compares a number when the operand is written bare: a quoted
 * `"20"` is matched against the cell's text and never hits a numeric cell.
 */
function formulaLiteral(value: string | number): string {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : `"${value}"`;
  const text = value.trim();
  return NUMERIC_CRITERION.test(text) ? text : `"${value.replaceAll('"', '""')}"`;
}

/** 'YYYY-MM-DD' → Excel 1900-system serial number (1899-12-30 = day 0). */
function dateSerial(iso: string): number | undefined {
  const parts = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (parts === null) return undefined;
  const ms = Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
  if (!Number.isFinite(ms)) return undefined;
  return Math.round((ms - Date.UTC(1899, 11, 30)) / 86_400_000);
}

/** Internal zero-based range → A1-style reference. */
function a1Range(range: { readonly r1: number; readonly c1: number; readonly r2: number; readonly c2: number }): string {
  return XLSX.utils.encode_range({ s: { r: range.r1, c: range.c1 }, e: { r: range.r2, c: range.c2 } });
}

/** "r,c:r,c" (internal range key) → normalized zero-based corners. */
function parseRangeKey(key: string): { r1: number; c1: number; r2: number; c2: number } {
  const [from, to] = key.split(':');
  const [r1, c1] = (from ?? '').split(',').map(Number);
  const [r2, c2] = (to ?? from ?? '').split(',').map(Number);
  return {
    r1: Math.min(r1 ?? 0, r2 ?? 0),
    c1: Math.min(c1 ?? 0, c2 ?? 0),
    r2: Math.max(r1 ?? 0, r2 ?? 0),
    c2: Math.max(c1 ?? 0, c2 ?? 0),
  };
}

function escapeText(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function escapeAttr(s: string): string {
  return escapeText(s).replaceAll('"', '&quot;');
}
