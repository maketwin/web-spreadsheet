import { cellFromText } from '../util/cell';
import type { RangeAddress } from '../selection/Range';
import type { Store } from '../store/Store';
import type { Cell } from '../types';

export interface ClipboardPayload {
  readonly text: string;
  readonly html: string;
}

export class ClipboardService {
  public static createPayload(store: Store, range: RangeAddress): ClipboardPayload | null {
    if (range.r2 < range.r1 || range.c2 < range.c1) return null;
    const matrix = readCellTexts(store, range);
    return { text: toTsv(matrix), html: toHtml(matrix) };
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
    return trimTrailingEmptyRow(text).split(/\r?\n/).map((row) => row.split('\t').map((value) => cellFromText(undefined, value)));
  }

  public static parseHtml(html: string): Cell[][] {
    if (typeof DOMParser === 'undefined') return [];
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return [...doc.querySelectorAll('tr')].map((row) => [...row.querySelectorAll('th,td')].map((cell) => cellFromText(undefined, cell.textContent ?? '')));
  }

  public static parsePaste(text: string, html?: string): Cell[][] {
    const htmlCells = html === undefined ? [] : ClipboardService.parseHtml(html);
    return htmlCells.length > 0 ? htmlCells : ClipboardService.parseText(text);
  }
}

function readCellTexts(store: Store, range: RangeAddress): string[][] {
  const rows: string[][] = [];
  for (let r = range.r1; r <= range.r2; r += 1) {
    const row: string[] = [];
    for (let c = range.c1; c <= range.c2; c += 1) row.push(store.getCell(r, c)?.text ?? '');
    rows.push(row);
  }
  return rows;
}

function toTsv(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => row.join('\t')).join('\n');
}

function toHtml(rows: readonly (readonly string[])[]): string {
  const body = rows.map((row) => `<tr>${row.map((value) => `<td>${escapeHtml(value)}</td>`).join('')}</tr>`).join('');
  return `<table>${body}</table>`;
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

function trimTrailingEmptyRow(text: string): string {
  return text.replace(/\r?\n$/, '');
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}
