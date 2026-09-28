import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { printPages, renderPrintPages, type PrintPagesResult } from '../../src/print/PrintPipeline';
import { contentPx, paperPx, marginPx, PRINT_DPI_SCALE, DEFAULT_PRINT_SETTINGS, type PrintSettings } from '../../src/print/types';
import { Store } from '../../src/store/Store';

/** jsdom has no canvas — page painting goes through a stubbed 2D context and
 * a stubbed toDataURL (the pipeline embeds each page as a PNG data URL). */
function installCanvas(): void {
  const ctx: Record<string, unknown> = {
    beginPath: vi.fn(), clip: vi.fn(), fillRect: vi.fn(), fillText: vi.fn(), lineTo: vi.fn(),
    measureText: vi.fn(() => ({ width: 24 } as TextMetrics)), moveTo: vi.fn(), rect: vi.fn(),
    restore: vi.fn(), save: vi.fn(), setLineDash: vi.fn(), setTransform: vi.fn(), stroke: vi.fn(),
    strokeRect: vi.fn(), drawImage: vi.fn(), clearRect: vi.fn(),
    textAlign: 'left', textBaseline: 'middle', fillStyle: '', globalAlpha: 1,
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,x');
}

function seedWideSheet(cols = 20): Store {
  const store = new Store();
  for (let c = 0; c < cols; c += 1) store.setCell(0, c, { text: `h${c}` });
  return store;
}

describe('renderPrintPages', () => {
  beforeEach(() => { installCanvas(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('renders one canvas per page, sized to the content area at print DPI', () => {
    const store = seedWideSheet();
    // Custom 100% keeps the 20 columns unscaled so the A4 portrait width
    // splits them into several column bands (fitWidth would fit them all).
    const settings: PrintSettings = { ...DEFAULT_PRINT_SETTINGS, scaleMode: 'custom', scalePercent: 100 };
    const result = renderPrintPages(store, store.getActiveSheetId(), settings);
    expect(result.geometry.pages.length).toBe(result.canvases.length);
    expect(result.geometry.pages.length).toBeGreaterThan(1);
    const content = contentPx(DEFAULT_PRINT_SETTINGS);
    for (const canvas of result.canvases) {
      expect(canvas.width).toBe(Math.round(content.w * PRINT_DPI_SCALE));
      expect(canvas.height).toBe(Math.round(content.h * PRINT_DPI_SCALE));
    }
  });

  it('printArea intersects the used range; empty/invalid falls back to the used range', () => {
    const store = seedWideSheet();
    const sid = store.getActiveSheetId();
    const base = renderPrintPages(store, sid, DEFAULT_PRINT_SETTINGS).geometry.used;

    const clipped = renderPrintPages(store, sid, { ...DEFAULT_PRINT_SETTINGS, printArea: 'A1:C1' }).geometry.used;
    expect(clipped.c2).toBe(2); // clipped to the first 3 columns
    expect(clipped.r2).toBe(base.r2);

    const invalid = renderPrintPages(store, sid, { ...DEFAULT_PRINT_SETTINGS, printArea: 'not a range' }).geometry.used;
    expect(invalid).toEqual(base);

    const beyond = renderPrintPages(store, sid, { ...DEFAULT_PRINT_SETTINGS, printArea: 'A1:ZZ100' }).geometry.used;
    expect(beyond).toEqual(base); // clamped to the used range
  });

  it('landscape fits the wide sheet into fewer column bands than portrait', () => {
    const unscaled: PrintSettings = { ...DEFAULT_PRINT_SETTINGS, scaleMode: 'custom', scalePercent: 100 };
    // 40 unscaled columns: portrait content width splits into more column
    // bands than the wider landscape page.
    const wide = seedWideSheet(40);
    const portrait = renderPrintPages(wide, wide.getActiveSheetId(), unscaled).geometry.pages.length;
    const landscape = renderPrintPages(wide, wide.getActiveSheetId(), { ...unscaled, orientation: 'landscape' }).geometry.pages.length;
    expect(landscape).toBeLessThan(portrait);
  });
});

describe('printPages', () => {
  let printed: number;

  beforeEach(() => {
    installCanvas();
    printed = 0;
    vi.stubGlobal('print', () => { printed += 1; });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.getElementById('ss-print-root')?.remove();
    document.getElementById('ss-print-style')?.remove();
  });

  const run = (): PrintPagesResult => {
    const store = new Store();
    store.setCell(0, 0, { text: 'one' });
    store.setCell(0, 1, { text: 'two' });
    return renderPrintPages(store, store.getActiveSheetId(), DEFAULT_PRINT_SETTINGS);
  };

  it('builds the print DOM (paper-sized pages, margin-positioned images) and calls window.print', () => {
    const result = run();
    printPages(result, DEFAULT_PRINT_SETTINGS);

    const root = document.getElementById('ss-print-root');
    expect(root).not.toBeNull();
    expect(printed).toBe(1);

    const paper = paperPx(DEFAULT_PRINT_SETTINGS);
    const content = contentPx(DEFAULT_PRINT_SETTINGS);
    const margin = marginPx(DEFAULT_PRINT_SETTINGS);
    const pages = root!.querySelectorAll('.ss-print-page');
    expect(pages.length).toBe(result.canvases.length);
    const first = pages[0] as HTMLElement;
    expect(first.style.width).toBe(`${paper.w}px`);
    expect(first.style.height).toBe(`${paper.h}px`);
    const img = first.querySelector('img') as HTMLImageElement;
    expect(img.src).toBe('data:image/png;base64,x');
    expect(img.style.left).toBe(`${margin}px`);
    expect(img.style.width).toBe(`${content.w}px`);
  });

  it('emits an @page rule matching paper and orientation', () => {
    printPages(run(), { ...DEFAULT_PRINT_SETTINGS, paper: 'Letter', orientation: 'landscape' });
    const style = document.getElementById('ss-print-style') as HTMLStyleElement;
    expect(style).not.toBeNull();
    expect(style.textContent).toContain('@page { size: letter landscape; margin: 0; }');
  });

  it('afterprint removes the print DOM exactly once', () => {
    printPages(run(), DEFAULT_PRINT_SETTINGS);
    expect(document.getElementById('ss-print-root')).not.toBeNull();
    window.dispatchEvent(new Event('afterprint'));
    window.dispatchEvent(new Event('afterprint')); // idempotent cleanup
    expect(document.getElementById('ss-print-root')).toBeNull();
    expect(document.getElementById('ss-print-style')).toBeNull();
  });

  it('a second print call first removes the previous print DOM', () => {
    printPages(run(), DEFAULT_PRINT_SETTINGS);
    const stale = document.getElementById('ss-print-root');
    printPages(run(), DEFAULT_PRINT_SETTINGS);
    const fresh = document.getElementById('ss-print-root');
    expect(fresh).not.toBeNull();
    expect(fresh).not.toBe(stale);
    expect(document.querySelectorAll('#ss-print-root').length).toBe(1);
  });
});
