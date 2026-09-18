import { cellFromText } from '../util/cell';
import type { RangeAddress } from '../selection/Range';
import type { Store } from '../store/Store';
import type { Cell, RichTextRun, RunStyle } from '../types';
import { isRich, normalizeRuns } from '../util/richText';
import { runSpanStyle, runStyleFromElement } from '../util/runStyleCss';

export interface ClipboardPayload {
  readonly text: string;
  readonly html: string;
}

export class ClipboardService {
  public static createPayload(store: Store, range: RangeAddress): ClipboardPayload | null {
    if (range.r2 < range.r1 || range.c2 < range.c1) return null;
    const cells = readCellMatrix(store, range);
    const text = toTsv(cells.map((row) => row.map((cell) => cell?.text ?? '')));
    const html = toHtml(cells);
    return { text, html };
  }

  public static async copy(store: Store, range: RangeAddress, clipboard: Clipboard = navigator.clipboard): Promise<boolean> {
    const payload = ClipboardService.createPayload(store, range);
    if (payload === null) return false;
    await writeClipboard(clipboard, payload);
    return true;
  }

  public static async cut(store: Store, range: RangeAddress, clipboard: Clipboard = navigator.clipboard): Promise<boolean> {
    return ClipboardService.copy(store, range, clipboard);
  }

  public static async read(clipboard: Clipboard = navigator.clipboard): Promise<Cell[][]> {
    if (typeof clipboard.read === 'function') {
      const rich = await readRichClipboard(clipboard);
      if (rich.length > 0) return rich;
    }
    return ClipboardService.parseText(await clipboard.readText());
  }

  public static parseText(text: string): Cell[][] {
    if (text.length === 0) return [];
    return parseDelimited(trimTrailingEmptyRow(text)).map((row) => row.map((value) => cellFromText(undefined, value)));
  }

  public static parseHtml(html: string): Cell[][] {
    if (typeof DOMParser === 'undefined') return [];
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return [...doc.querySelectorAll('tr')].map((row) => [...row.querySelectorAll('th,td')].map((cell) => cellFromHtml(cell)));
  }

  public static parsePaste(text: string, html?: string): Cell[][] {
    const htmlCells = html === undefined ? [] : ClipboardService.parseHtml(html);
    return htmlCells.length > 0 ? htmlCells : ClipboardService.parseText(text);
  }
}

function readCellMatrix(store: Store, range: RangeAddress): ReadonlyArray<ReadonlyArray<Cell | undefined>> {
  const rows: Array<Array<Cell | undefined>> = [];
  for (let r = range.r1; r <= range.r2; r += 1) {
    const row: Array<Cell | undefined> = [];
    for (let c = range.c1; c <= range.c2; c += 1) row.push(store.getCell(r, c));
    rows.push(row);
  }
  return rows;
}

function toTsv(rows: readonly (readonly string[])[]): string {
  // Excel-style quoting on write: a field containing a delimiter, newline, or
  // quote is wrapped and its quotes doubled, so copy/paste round-trips.
  const quote = (value: string): string => (/[\t\n\r"]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value);
  return rows.map((row) => row.map(quote).join('\t')).join('\n');
}

function toHtml(cells: ReadonlyArray<ReadonlyArray<Cell | undefined>>): string {
  const body = cells.map((row) => `<tr>${row.map((cell) => tdHtml(cell)).join('')}</tr>`).join('');
  return `<table>${body}</table>`;
}

/** Rich runs become styled spans (Excel-compatible clipboard HTML); plain cells stay bare. */
function tdHtml(cell: Cell | undefined): string {
  const text = cell?.text ?? '';
  if (cell === undefined || !isRich(cell.richText)) return `<td>${escapeHtml(text)}</td>`;
  const spans = cell.richText.map((run) => `<span${styleAttr(runSpanStyle(run.style ?? {}))}>${escapeHtml(run.text)}</span>`).join('');
  return `<td>${spans}</td>`;
}

function styleAttr(style: string): string {
  return style === '' ? '' : ` style="${escapeHtml(style)}"`;
}

/** One `<td>` → cell; run-level styles from nested spans/tags become richText. */
function cellFromHtml(td: Element): Cell {
  const runs: RichTextRun[] = [];
  collectRuns(td, {}, runs);
  const text = runs.map((run) => run.text).join('');
  const cell = cellFromText(undefined, text);
  const normalized = normalizeRuns(runs);
  if (normalized !== undefined) cell.richText = normalized;
  return cell;
}

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

function collectRuns(node: Node, inherited: RunStyle, out: RichTextRun[]): void {
  for (const child of node.childNodes) {
    if (child.nodeType === TEXT_NODE) {
      const text = child.textContent ?? '';
      if (text !== '') out.push(Object.keys(inherited).length > 0 ? { text, style: { ...inherited } } : { text });
      continue;
    }
    if (child.nodeType === ELEMENT_NODE) {
      const el = child as HTMLElement;
      if (el.tagName.toLowerCase() === 'br') { out.push({ text: '\n' }); continue; }
      collectRuns(el, { ...inherited, ...runStyleFromElement(el) }, out);
    }
  }
}

async function writeClipboard(clipboard: Clipboard, payload: ClipboardPayload): Promise<void> {
  if (typeof ClipboardItem !== 'undefined' && typeof clipboard.write === 'function') {
    await clipboard.write([new ClipboardItem({ 'text/html': blob(payload.html, 'text/html'), 'text/plain': blob(payload.text, 'text/plain') })]);
    return;
  }
  await clipboard.writeText(payload.text);
}

async function readRichClipboard(clipboard: Clipboard): Promise<Cell[][]> {
  const items = await clipboard.read();
  for (const item of items) {
    if (item.types.includes('text/html')) return ClipboardService.parseHtml(await (await item.getType('text/html')).text());
  }
  return [];
}

function blob(value: string, type: string): Blob {
  return new Blob([value], { type });
}

/**
 * Tab-delimited text with CSV-style quoting (Excel external paste): a field
 * wrapped in double quotes may embed tabs and newlines; "" is a literal quote.
 */
function parseDelimited(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let i = 0;
  const pushField = (): void => { row.push(field); field = ''; };
  const pushRow = (): void => { pushField(); rows.push(row); row = []; };
  while (i < text.length) {
    // Only a quote at the very start of a field opens a quoted run — a quote
    // mid-field (`ab"c`) is a literal, like Excel's external paste handling.
    if (text[i] === '"' && field === '') {
      // Quoted field: consume until the closing quote.
      i += 1;
      while (i < text.length) {
        if (text[i] === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          i += 1;
          break;
        }
        field += text[i];
        i += 1;
      }
      continue;
    }
    const ch = text[i];
    if (ch === '\t') { pushField(); i += 1; continue; }
    if (ch === '\n') { pushRow(); i += 1; continue; }
    if (ch === '\r') { i += 1; continue; }
    field += ch;
    i += 1;
  }
  pushRow();
  return rows;
}

function trimTrailingEmptyRow(text: string): string {
  return text.replace(/\r?\n$/, '');
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}
