import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  printPages,
  renderWorkbookPrintPages,
  renderWorkbookPrintPagesAsync,
  type WorkbookRenderProgress,
} from '../../src/print/PrintPipeline';
import { DEFAULT_PRINT_SETTINGS, type PrintSettings } from '../../src/print/types';
import { Store } from '../../src/store/Store';

/** jsdom has no canvas — page painting goes through a stubbed 2D context and a
 * counter-stubbed toDataURL so each page's PNG encoding is individually
 * identifiable (p0, p1, …) to verify print order. */
let canvasCtx: Record<string, unknown>;
function installCanvas(): void {
  let encoded = 0;
  canvasCtx = {
    beginPath: vi.fn(), clip: vi.fn(), fillRect: vi.fn(), fillText: vi.fn(), lineTo: vi.fn(),
    measureText: vi.fn(() => ({ width: 24 } as TextMetrics)), moveTo: vi.fn(), rect: vi.fn(),
    restore: vi.fn(), save: vi.fn(), setLineDash: vi.fn(), setTransform: vi.fn(), stroke: vi.fn(),
    strokeRect: vi.fn(), drawImage: vi.fn(), clearRect: vi.fn(),
    textAlign: 'left', textBaseline: 'middle', fillStyle: '', globalAlpha: 1,
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(canvasCtx as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(() => `data:image/png;base64,p${encoded++}`);
}

/** Minimal Image stand-in: resolves onload from the src setter like a data URL would. */
class FakeImage {
  static readonly instances: FakeImage[] = [];
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  width = 8;
  height = 4;
  naturalWidth = 8;
  naturalHeight = 4;
  private srcValue = '';
  public constructor() { FakeImage.instances.push(this); }
  public set src(value: string) { this.srcValue = value; queueMicrotask(() => this.onload?.()); }
  public get src(): string { return this.srcValue; }
}

function seedWideSheet(cols = 20): Store {
  const store = new Store();
  for (let c = 0; c < cols; c += 1) store.setCell(0, c, { text: `h${c}` });
  return store;
}

/** Unscaled 100% so a 20-column sheet splits into several column bands. */
const multiPageSettings: PrintSettings = { ...DEFAULT_PRINT_SETTINGS, scaleMode: 'custom', scalePercent: 100 };

/** Real-ish yielding: route rAF through a macrotask so the async loop actually suspends. */
function installFrameSpy() {
  return vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
    window.setTimeout(() => cb(performance.now()), 0);
    return 0;
  });
}

beforeEach(() => {
  installCanvas();
  vi.stubGlobal('Image', FakeImage);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('renderWorkbookPrintPagesAsync', () => {
  it('renders the same page count, geometry and order as the sync version', async () => {
    const store = seedWideSheet();
    const sync = renderWorkbookPrintPages(store, multiPageSettings, 'active');
    const async = await renderWorkbookPrintPagesAsync(store, multiPageSettings, 'active');

    expect(async.totalPages).toBe(sync.totalPages);
    expect(async.totalPages).toBeGreaterThan(1);
    expect(async.parts.length).toBe(sync.parts.length);
    expect(async.parts.map((p) => p.sheetId)).toEqual(sync.parts.map((p) => p.sheetId));
    for (let i = 0; i < async.parts.length; i += 1) {
      expect(async.parts[i]?.geometry.pages.length).toBe(sync.parts[i]?.geometry.pages.length);
      expect(async.parts[i]?.geometry).toEqual(sync.parts[i]?.geometry);
    }
    // pages mirrors canvases by identity, in print order.
    expect(async.pages.length).toBe(async.canvases.length);
    for (let i = 0; i < async.pages.length; i += 1) expect(async.pages[i]?.canvas).toBe(async.canvases[i]);
    // The counter-stubbed encoder proves page order: k-th page encoded k-th.
    for (let i = 0; i < async.pages.length; i += 1) expect(async.pages[i]?.dataUrl).toBe(`data:image/png;base64,p${i}`);
  });

  it('keeps workbook-global {page} renumbering across sheets like the sync path', async () => {
    const store = seedWideSheet(20);
    const second = store.addSheet('数据2');
    for (let c = 0; c < 20; c += 1) store.setCell(0, c, { text: `s2h${c}` }, second);
    const settings: PrintSettings = { ...multiPageSettings, headerText: '{page}/{pages}' };

    const sync = renderWorkbookPrintPages(store, settings, 'workbook');
    const async = await renderWorkbookPrintPagesAsync(store, settings, 'workbook');

    // Same pagination shape per sheet, same global total.
    expect(async.parts.map((p) => p.geometry.pages.length)).toEqual(sync.parts.map((p) => p.geometry.pages.length));
    expect(async.totalPages).toBe(sync.totalPages);
    // Global numbering: the flat dataUrl sequence continues across the sheet
    // boundary (part 2 starts where part 1 ended), matching sync page order.
    const perSheet = async.parts.map((p) => p.geometry.pages.length);
    expect(perSheet[0]).toBeGreaterThan(0);
    expect(perSheet[1]).toBeGreaterThan(0);
    expect(async.pages.length).toBe(perSheet[0]! + perSheet[1]!);
    for (let i = 0; i < async.pages.length; i += 1) expect(async.pages[i]?.dataUrl).toBe(`data:image/png;base64,p${i}`);
  });

  it('reports progress exactly once per page with done increasing to total', async () => {
    const store = seedWideSheet();
    const events: WorkbookRenderProgress[] = [];
    const result = await renderWorkbookPrintPagesAsync(store, multiPageSettings, 'active', (p) => events.push(p));

    expect(events.length).toBe(result.totalPages);
    expect(events.map((e) => e.done)).toEqual(Array.from({ length: result.totalPages }, (_, i) => i + 1));
    expect(events.map((e) => e.pageIndex)).toEqual(Array.from({ length: result.totalPages }, (_, i) => i));
    for (const e of events) expect(e.total).toBe(result.totalPages);
    // Each event carries the page just finished, in print order.
    for (let i = 0; i < events.length; i += 1) expect(events[i]?.canvas).toBe(result.canvases[i]);
  });

  it('yields to the main thread between pages', async () => {
    const store = seedWideSheet();
    const raf = installFrameSpy();
    const result = await renderWorkbookPrintPagesAsync(store, multiPageSettings, 'active');
    // One real-frame yield after every page except the last.
    expect(result.totalPages).toBeGreaterThan(1);
    expect(raf.mock.calls.length).toBe(result.totalPages - 1);
  });

  /** Multi-page sheet: 20 columns (2 col bands) × 60 rows (2 row bands) → 4 pages. */
  function seedManyPages(): Store {
    const store = new Store();
    for (let r = 0; r < 60; r += 1) {
      for (let c = 0; c < 20; c += 1) store.setCell(r, c, { text: `${r},${c}` });
    }
    return store;
  }

  it('serves timer probes posted from onProgress between pages even when scheduler.yield exists', async () => {
    // Chrome's scheduler.yield() continuation runs as a microtask ahead of
    // already-queued same-priority tasks: a work → await scheduler.yield()
    // loop starves timers and MessageChannel tasks (React's render
    // scheduling) until the loop ends. This stub mimics that — resolving
    // without ever letting a macrotask run — so the test fails if the yield
    // goes back to awaiting scheduler.yield() alone.
    vi.stubGlobal('scheduler', { yield: () => Promise.resolve() });
    installFrameSpy();
    const store = seedManyPages();
    const served: number[] = [];
    const result = await renderWorkbookPrintPagesAsync(store, multiPageSettings, 'active', (p) => {
      // The probe posted when page n finished must have fired by the time
      // onProgress reports page n+1.
      if (p.done > 1) expect(served, `timer probe from page ${p.done - 1} not served by page ${p.done}`).toContain(p.done - 1);
      if (p.done < p.total) window.setTimeout(() => served.push(p.done), 0);
    });
    expect(result.totalPages).toBeGreaterThanOrEqual(3);
    expect(served).toEqual(Array.from({ length: result.totalPages - 1 }, (_, i) => i + 1));
  });

  it('aborts between pages: rejects with AbortError and stops progress', async () => {
    const store = seedWideSheet();
    const controller = new AbortController();
    const events: WorkbookRenderProgress[] = [];
    const pending = renderWorkbookPrintPagesAsync(
      store,
      multiPageSettings,
      'active',
      (p) => {
        events.push(p);
        if (p.done === 1) controller.abort();
      },
      controller.signal,
    );
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(events.length).toBe(1);
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const store = seedWideSheet();
    const controller = new AbortController();
    controller.abort();
    const events: WorkbookRenderProgress[] = [];
    await expect(
      renderWorkbookPrintPagesAsync(store, multiPageSettings, 'active', (p) => events.push(p), controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(events.length).toBe(0);
  });

  it('prints floating data-URL images over the cells; non-data sources are skipped', async () => {
    const store = seedWideSheet(3);
    store.addImage({
      id: 'img1',
      name: 'logo',
      src: 'data:image/png;base64,AAAA',
      anchor: { from: { r: 0, c: 0, offX: 2, offY: 2 }, to: { r: 1, c: 1, offX: 0, offY: 0 } },
    });
    store.addImage({
      id: 'img2',
      name: 'remote',
      src: 'https://example.com/picture.png',
      anchor: { from: { r: 0, c: 0, offX: 0, offY: 0 }, to: { r: 1, c: 1, offX: 0, offY: 0 } },
    });

    const result = await renderWorkbookPrintPagesAsync(store, multiPageSettings, 'active');
    expect(result.canvases.length).toBe(1);

    const draws = canvasCtx.drawImage as ReturnType<typeof vi.fn>;
    expect(draws).toHaveBeenCalledTimes(1);
    const [el, dx, dy, dw, dh] = draws.mock.calls[0] as unknown[];
    expect(el).toBeInstanceOf(FakeImage);
    // Contained inside the anchor rect, which starts at the (0,0) cell + 2px offset.
    expect(dw).toBeGreaterThan(0);
    expect(dh).toBeGreaterThan(0);
    expect(dx).toBeGreaterThanOrEqual(2);
    expect(dy).toBeGreaterThanOrEqual(2);
  });
});

describe('printPages with pre-encoded pages', () => {
  beforeEach(() => {
    vi.stubGlobal('print', () => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.getElementById('ss-print-root')?.remove();
    document.getElementById('ss-print-style')?.remove();
  });

  it('uses the pre-encoded dataUrls and never re-encodes the canvases', async () => {
    const store = seedWideSheet(20);
    const result = await renderWorkbookPrintPagesAsync(store, multiPageSettings, 'active');
    const encodeSpy = vi.mocked(HTMLCanvasElement.prototype.toDataURL);
    encodeSpy.mockClear();

    printPages(result, multiPageSettings);

    expect(encodeSpy).not.toHaveBeenCalled();
    const root = document.getElementById('ss-print-root');
    const imgs = root!.querySelectorAll('img');
    expect(imgs.length).toBe(result.pages.length);
    for (let i = 0; i < imgs.length; i += 1) expect(imgs[i]?.src).toBe(result.pages[i]?.dataUrl);
  });
});
