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
import { parseRange } from '../util/rangeNotation';
import { paginate, usedRange, type PrintGeometry, type UsedRange } from './PrintPaginator';
import { PrintPainter, type PrintImageLayer } from './PrintPainter';
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

export interface SheetPrintPlan {
  readonly sheetId: string;
  readonly sheetName: string;
  readonly geometry: PrintGeometry;
}

export interface WorkbookPrintPlan {
  readonly parts: readonly SheetPrintPlan[];
  readonly totalPages: number;
}

/** Cheap pagination pass (no painting): per-sheet page layout plus the global
 * page count. UI can show totals and scale before any canvas exists. */
export function planWorkbookPrintPages(store: Store, settings: PrintSettings, scope: PrintScope = 'active'): WorkbookPrintPlan {
  const sheets = scope === 'workbook' ? store.getSheets() : store.getSheets().filter((s) => s.id === store.getActiveSheetId());
  // Paginate every sheet up front so {pages} can carry the global total.
  const parts = sheets.map((sheet) => {
    const used = resolvePrintArea(store, sheet.id, settings);
    return { sheetId: sheet.id, sheetName: sheet.name, geometry: paginate(store, sheet.id, used, settings) };
  });
  const totalPages = parts.reduce((sum, part) => sum + part.geometry.pages.length, 0);
  return { parts, totalPages };
}

/** Paginate + paint the active sheet or the whole workbook.
 * Page numbers in header/footer text ({page}/{pages}) are workbook-global.
 * Synchronous — painting every page in one go blocks the main thread; the
 * async variant (renderWorkbookPrintPagesAsync) chunks the same output. */
export function renderWorkbookPrintPages(store: Store, settings: PrintSettings, scope: PrintScope = 'active'): WorkbookPrintResult {
  const plan = planWorkbookPrintPages(store, settings, scope);
  const parts: SheetPrintPart[] = [];
  const canvases: HTMLCanvasElement[] = [];
  let painted = 0;
  for (const partPlan of plan.parts) {
    const painter = new PrintPainter(store, partPlan.sheetId);
    const sheetCanvases = partPlan.geometry.pages.map((page) => {
      // The painter reads page.index for {page} — renumber against the
      // workbook-global running count (single-sheet scope: unchanged).
      const global = page.index + painted;
      const numbered = global === page.index ? page : { ...page, index: global };
      return painter.paint(numbered, partPlan.geometry.scale, settings, plan.totalPages);
    });
    parts.push({ sheetId: partPlan.sheetId, sheetName: partPlan.sheetName, geometry: partPlan.geometry, canvases: sheetCanvases });
    canvases.push(...sheetCanvases);
    painted += partPlan.geometry.pages.length;
  }
  return { parts, canvases, totalPages: plan.totalPages };
}

/** One rendered page plus its pre-encoded PNG data URL. */
export interface WorkbookPrintPage {
  readonly canvas: HTMLCanvasElement;
  readonly dataUrl: string;
}

/** Progress payload: fires once per finished page, in print order. */
export interface WorkbookRenderProgress {
  /** 1-based count of finished pages (increments to `total`). */
  readonly done: number;
  readonly total: number;
  /** Workbook-global 0-based index of the page just finished. */
  readonly pageIndex: number;
  readonly canvas: HTMLCanvasElement;
  readonly dataUrl: string;
}

export interface AsyncWorkbookPrintResult extends WorkbookPrintResult {
  /** Pages with pre-encoded PNG data URLs, in print order — lets printPages skip toDataURL. */
  readonly pages: readonly WorkbookPrintPage[];
}

/** Give the main thread a real frame between pages: rAF followed by a
 * macrotask (rAF alone can run before the browser has painted, so a following
 * setTimeout guarantees the frame; setTimeout(0) alone when rAF is missing).
 * scheduler.yield() is deliberately not used: in Chrome its continuation runs
 * ahead of already-queued same-priority tasks, so a yield loop starves timers
 * and MessageChannel tasks (React's render scheduling) until the loop ends. */
export async function yieldToMainThread(): Promise<void> {
  await new Promise<void>((resolve) => {
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => { window.setTimeout(resolve, 0); });
    } else {
      window.setTimeout(resolve, 0);
    }
  });
}

function abortError(): DOMException {
  return new DOMException('print rendering aborted', 'AbortError');
}

/** Load one data-URL image; null on failure (a broken image must not block printing). */
function loadPrintImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const el = new Image();
    const finish = (ok: boolean): void => {
      el.onload = null;
      el.onerror = null;
      resolve(ok ? el : null);
    };
    el.onload = () => finish(true);
    el.onerror = () => finish(false);
    el.src = src;
  });
}

/** Excel prints floating images. Only data-URL images are supported (no
 * network fetches here); each is loaded once per sheet before its pages paint. */
async function loadPrintImageLayers(store: Store, sheetId: string): Promise<readonly PrintImageLayer[]> {
  const specs = store.getImages(sheetId).filter((spec) => spec.src.startsWith('data:'));
  const layers: PrintImageLayer[] = [];
  for (const spec of specs) {
    const el = await loadPrintImage(spec.src);
    if (el !== null) layers.push({ el, spec });
  }
  return layers;
}

/** Progressive twin of renderWorkbookPrintPages: pagination runs synchronously
 * (cheap), then pages paint one at a time. After each page the PNG is encoded
 * immediately (amortizing toDataURL into the chunks), `onProgress` fires, and
 * the main thread is yielded so the preview UI can repaint. `signal` cancels —
 * rejects with an AbortError named DOMException once the signal is set; no
 * further pages paint and onProgress stops firing.
 *
 * Signature: renderWorkbookPrintPagesAsync(
 *   store, settings, scope = 'active',
 *   onProgress?: (p: WorkbookRenderProgress) => void,
 *   signal?: AbortSignal,
 * ): Promise<AsyncWorkbookPrintResult>
 */
export async function renderWorkbookPrintPagesAsync(
  store: Store,
  settings: PrintSettings,
  scope: PrintScope = 'active',
  onProgress?: ((progress: WorkbookRenderProgress) => void) | undefined,
  signal?: AbortSignal | undefined,
): Promise<AsyncWorkbookPrintResult> {
  if (signal?.aborted === true) throw abortError();
  const plan = planWorkbookPrintPages(store, settings, scope);
  const partCanvases: HTMLCanvasElement[][] = plan.parts.map(() => []);
  const pages: WorkbookPrintPage[] = [];
  const canvases: HTMLCanvasElement[] = [];
  const throwIfAborted = (): void => {
    if (signal?.aborted === true) throw abortError();
  };
  let done = 0;
  // Workbook-global running count for {page} (per sheet: down-then-across) —
  // the base accumulates per part, exactly like the sync version.
  let plannedBefore = 0;
  for (let partIdx = 0; partIdx < plan.parts.length; partIdx += 1) {
    const partPlan = plan.parts[partIdx]!;
    const painter = new PrintPainter(store, partPlan.sheetId);
    // Only await image loading when there is something to load — an empty
    // sheet keeps the whole first page on the synchronous effect path.
    let images: readonly PrintImageLayer[] = [];
    if (partPlan.geometry.pages.length > 0 && store.getImages(partPlan.sheetId).some((spec) => spec.src.startsWith('data:'))) {
      images = await loadPrintImageLayers(store, partPlan.sheetId);
      throwIfAborted();
    }
    for (const page of partPlan.geometry.pages) {
      throwIfAborted();
      const global = page.index + plannedBefore;
      const numbered = global === page.index ? page : { ...page, index: global };
      const canvas = painter.paint(numbered, partPlan.geometry.scale, settings, plan.totalPages, images);
      const dataUrl = canvas.toDataURL('image/png');
      partCanvases[partIdx]!.push(canvas);
      pages.push({ canvas, dataUrl });
      canvases.push(canvas);
      done += 1;
      onProgress?.({ done, total: plan.totalPages, pageIndex: global, canvas, dataUrl });
      // Yield after every page except the last — the caller's .then completes
      // the render without an extra frame of latency.
      if (done < plan.totalPages) {
        throwIfAborted();
        await yieldToMainThread();
      }
    }
    plannedBefore += partPlan.geometry.pages.length;
  }
  const parts: SheetPrintPart[] = plan.parts.map((partPlan, i) => ({
    sheetId: partPlan.sheetId,
    sheetName: partPlan.sheetName,
    geometry: partPlan.geometry,
    canvases: partCanvases[i] ?? [],
  }));
  return { parts, canvases, totalPages: plan.totalPages, pages };
}

const PRINT_ROOT_ID = 'ss-print-root';
const PRINT_STYLE_ID = 'ss-print-style';
/** Fallback cleanup delay when afterprint never fires (some embedded WebViews). */
const CLEANUP_FALLBACK_MS = 60_000;

export function printPages(
  result: { readonly canvases: readonly HTMLCanvasElement[]; readonly pages?: readonly { readonly dataUrl: string }[] },
  settings: PrintSettings,
): void {
  cleanupPrintDocument();
  const paper = paperPx(settings);
  const content = contentPx(settings);
  const margin = marginPx(settings);

  const root = document.createElement('div');
  root.id = PRINT_ROOT_ID;
  result.canvases.forEach((canvas, index) => {
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
    // Prefer the pre-encoded PNG from an async render; the sync path still
    // encodes here (only once per canvas either way).
    img.src = result.pages?.[index]?.dataUrl ?? canvas.toDataURL('image/png');
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
