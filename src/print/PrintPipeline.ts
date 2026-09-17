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
import { paginate, usedRange, type PrintGeometry } from './PrintPaginator';
import { PrintPainter } from './PrintPainter';
import { contentPx, marginPx, paperPx, type PaperSize, type PrintSettings } from './types';

export interface PrintPagesResult {
  readonly geometry: PrintGeometry;
  readonly canvases: readonly HTMLCanvasElement[];
}

/** Paginate and paint every page of the sheet for the given settings. */
export function renderPrintPages(store: Store, sheetId: string, settings: PrintSettings): PrintPagesResult {
  const geometry = paginate(store, sheetId, usedRange(store, sheetId), settings);
  const painter = new PrintPainter(store, sheetId);
  const canvases = geometry.pages.map((page) => painter.paint(page, geometry.scale, settings));
  return { geometry, canvases };
}

const PRINT_ROOT_ID = 'ss-print-root';
const PRINT_STYLE_ID = 'ss-print-style';
/** Fallback cleanup delay when afterprint never fires (some embedded WebViews). */
const CLEANUP_FALLBACK_MS = 60_000;

export function printPages(result: PrintPagesResult, settings: PrintSettings): void {
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
