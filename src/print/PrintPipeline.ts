/** Browser-side print orchestration: render pages, build the print DOM, call window.print().
 *
 * The print document is a hidden `#ss-print-root` container holding one
 * paper-sized div per page (page-break-after: always) with the rendered page
 * canvas embedded as a PNG image at the margin offset. `@page { margin: 0 }`
 * makes the div itself the full paper; the app UI is hidden via injected
 * print CSS for the duration of the print call and everything is removed on
 * `afterprint` (with a timeout fallback for environments that never fire it).
 */
import type { Store } from '../store/Store';
import { parseRange } from '../util/cell';
import { paginate, usedRange, type PrintGeometry, type UsedRange } from './PrintPaginator';
import { PrintPainter } from './PrintPainter';
import { contentPx, marginPx, paperPx, type PaperSize, type PrintSettings } from './types';

export interface PrintPagesResult {
  readonly geometry: PrintGeometry;
  readonly canvases: readonly HTMLCanvasElement[];
}

/** Intersect the configured print area with the used range (invalid → used range). */
const A1_RANGE_RE = /^[A-Za-z]{1,3}[1-9]\d*(:[A-Za-z]{1,3}[1-9]\d*)?$/;
function resolvePrintArea(store: Store, sheetId: string, settings: PrintSettings): UsedRange {
  const base = usedRange(store, sheetId);
  const area = settings.printArea?.trim();
  // util/cell.parseRange is forgiving (garbage collapses to A1) — validate the
  // A1 shape first so an invalid print area falls back to the whole used range.
  if (area === undefined || area === '' || !A1_RANGE_RE.test(area)) return base;
  try {
    const parsed = parseRange(area);
    const coords = [parsed.r1, parsed.c1, parsed.r2, parsed.c2];
    if (!coords.every((n) => Number.isFinite(n))) return base;
    return {
      r1: Math.max(base.r1, parsed.r1),
      c1: Math.max(base.c1, parsed.c1),
      r2: Math.min(base.r2, parsed.r2),
      c2: Math.min(base.c2, parsed.c2),
    };
  } catch {
    return base;
  }
}

/** Paginate and paint every page of the sheet for the given settings. */
export function renderPrintPages(store: Store, sheetId: string, settings: PrintSettings): PrintPagesResult {
  const used = resolvePrintArea(store, sheetId, settings);
  const geometry = paginate(store, sheetId, used, settings);
  const painter = new PrintPainter(store, sheetId);
  const canvases = geometry.pages.map((page) => painter.paint(page, geometry.scale, settings, geometry.pages.length));
  return { geometry, canvases };
}

/** 打印范围：当前工作表 / 整个工作簿（按标签顺序）。 */
export type PrintScope = 'active' | 'workbook';

export interface SheetPrintPart {
  readonly sheetId: string;
  readonly sheetName: string;
  readonly geometry: PrintGeometry;
  readonly canvases: readonly HTMLCanvasElement[];
}

export interface WorkbookPrintResult {
  readonly parts: readonly SheetPrintPart[];
  /** Flat page canvases in print order (per sheet: down-then-across; sheets in tab order). */
  readonly canvases: readonly HTMLCanvasElement[];
  readonly totalPages: number;
}

/** Paginate + paint the active sheet or the whole workbook.
 * Page numbers in header/footer text ({page}/{pages}) are workbook-global. */
export function renderWorkbookPrintPages(store: Store, settings: PrintSettings, scope: PrintScope = 'active'): WorkbookPrintResult {
  const sheets = scope === 'workbook' ? store.getSheets() : store.getSheets().filter((s) => s.id === store.getActiveSheetId());
  // First pass paginates every sheet so {pages} can carry the global total.
  const paginated = sheets.map((sheet) => {
    const used = resolvePrintArea(store, sheet.id, settings);
    return { sheet, geometry: paginate(store, sheet.id, used, settings) };
  });
  const totalPages = paginated.reduce((sum, part) => sum + part.geometry.pages.length, 0);
  const parts: SheetPrintPart[] = [];
  const canvases: HTMLCanvasElement[] = [];
  let pageIndex = 0;
  for (const { sheet, geometry } of paginated) {
    const painter = new PrintPainter(store, sheet.id);
    const sheetCanvases = geometry.pages.map((page) => {
      // The painter reads page.index for {page} — renumber against the
      // workbook-global running count (single-sheet scope: unchanged).
      const global = page.index + pageIndex;
      const numbered = global === page.index ? page : { ...page, index: global };
      return painter.paint(numbered, geometry.scale, settings, totalPages);
    });
    parts.push({ sheetId: sheet.id, sheetName: sheet.name, geometry, canvases: sheetCanvases });
    canvases.push(...sheetCanvases);
    pageIndex += geometry.pages.length;
  }
  return { parts, canvases, totalPages };
}

const PRINT_ROOT_ID = 'ss-print-root';
const PRINT_STYLE_ID = 'ss-print-style';
/** Fallback cleanup delay when afterprint never fires (some embedded WebViews). */
const CLEANUP_FALLBACK_MS = 60_000;

export function printPages(result: { readonly canvases: readonly HTMLCanvasElement[] }, settings: PrintSettings): void {
  cleanupPrintDocument();
  const paper = paperPx(settings);
  const content = contentPx(settings);
  const margin = marginPx(settings);

  const root = document.createElement('div');
  root.id = PRINT_ROOT_ID;
  result.canvases.forEach((canvas) => {
    const pageDiv = document.createElement('div');
    pageDiv.className = 'ss-print-page';
    // The page img is absolutely positioned at the margin offset — without a
    // positioned ancestor it resolves against the print root (or the initial
    // containing block once the root goes static in print media), stacking
    // every page's image on page 1 and leaving later pages blank.
    pageDiv.style.position = 'relative';
    pageDiv.style.width = `${paper.w}px`;
    pageDiv.style.height = `${paper.h}px`;
    const img = document.createElement('img');
    img.alt = '';
    img.src = canvas.toDataURL('image/png');
    img.style.position = 'absolute';
    img.style.left = `${margin}px`;
    img.style.top = `${margin}px`;
    img.style.width = `${content.w}px`;
    img.style.height = `${content.h}px`;
    pageDiv.append(img);
    root.append(pageDiv);
  });

  const style = document.createElement('style');
  style.id = PRINT_STYLE_ID;
  style.textContent = [
    `@page { size: ${pageRuleSize(settings.paper)} ${settings.orientation}; margin: 0; }`,
    `#${PRINT_ROOT_ID} { position: absolute; left: -10000px; top: 0; }`,
    '@media print {',
    '  html, body { margin: 0 !important; padding: 0 !important; background: #ffffff !important; }',
    '  .ss-root { display: none !important; }',
    `  #${PRINT_ROOT_ID} { position: static; left: auto; top: auto; }`,
    '  .ss-print-page { overflow: hidden; break-after: page; page-break-after: always; }',
    '  .ss-print-page:last-child { break-after: auto; page-break-after: auto; }',
    '  .ss-print-page img { display: block; }',
    '}',
  ].join('\n');

  let done = false;
  const cleanup = (): void => {
    if (done) return;
    done = true;
    window.removeEventListener('afterprint', cleanup);
    root.remove();
    style.remove();
  };

  document.body.append(style, root);
  window.addEventListener('afterprint', cleanup, { once: true });
  window.setTimeout(cleanup, CLEANUP_FALLBACK_MS);
  window.print();
}

/** Remove leftovers from an interrupted print (e.g. afterprint never fired). */
function cleanupPrintDocument(): void {
  document.getElementById(PRINT_ROOT_ID)?.remove();
  document.getElementById(PRINT_STYLE_ID)?.remove();
}

function pageRuleSize(paper: PaperSize): string {
  return paper === 'Letter' ? 'letter' : paper;
}
