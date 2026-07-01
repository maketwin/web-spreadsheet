import type { Store } from '../store/Store';
import type { Cell } from '../types';
import { DirtyRegionTracker, type Rect } from './DirtyRegionTracker';
import { VirtualScroller, type VisibleRange } from './VirtualScroller';

export interface CanvasRendererOptions {
  canvas: HTMLCanvasElement;
  store: Store;
  devicePixelRatio?: number;
}

export class CanvasRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly scroller: VirtualScroller;
  private readonly dirty = new DirtyRegionTracker();
  private readonly unsubscribe: () => void;
  private rafId: number | null = null;

  public constructor(private readonly opts: CanvasRendererOptions) {
    const ctx = opts.canvas.getContext('2d');
    if (ctx === null) throw new Error('Canvas 2D context not available');

    this.ctx = ctx;
    this.scroller = new VirtualScroller({
      totalRows: 1_000,
      totalCols: 26,
      defaultRowHeight: 25,
      defaultColWidth: 100,
      viewportW: this.getViewportWidth(),
      viewportH: this.getViewportHeight(),
    });
    this.unsubscribe = opts.store.subscribe(() => this.onStoreChange());
    this.setupCanvas();
    this.dirty.invalidateAll();
    this.scheduleRender();
  }

  public destroy(): void {
    if (this.rafId !== null) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.unsubscribe();
  }

  private setupCanvas(): void {
    const dpr = this.opts.devicePixelRatio ?? window.devicePixelRatio ?? 1;
    const width = this.getViewportWidth();
    const height = this.getViewportHeight();

    this.opts.canvas.width = Math.floor(width * dpr);
    this.opts.canvas.height = Math.floor(height * dpr);
    this.ctx.scale(dpr, dpr);
  }

  private onStoreChange(): void {
    this.dirty.invalidateAll();
    this.scheduleRender();
  }

  private scheduleRender(): void {
    if (this.rafId !== null) return;

    this.rafId = window.requestAnimationFrame(() => {
      this.rafId = null;
      this.render();
    });
  }

  private render(): void {
    if (this.dirty.isEmpty()) return;

    const regions = this.dirty.drain();
    const range = this.scroller.getVisibleRange();
    regions.forEach((region) => this.paintRegion(region, range));
  }

  private paintRegion(region: Rect, range: VisibleRange): void {
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.rect(region.x, region.y, region.w, region.h);
    this.ctx.clip();
    this.paintGrid(range);
    this.ctx.restore();
  }

  private paintGrid(range: VisibleRange): void {
    this.paintBackground();
    this.ctx.fillStyle = getCssVar('--ss-text', '#333');
    this.ctx.textBaseline = 'top';
    this.ctx.font = `14px ${getCssVar('--ss-font-family', 'sans-serif')}`;

    for (let r = range.startRow; r < range.endRow; r += 1) {
      for (let c = range.startCol; c < range.endCol; c += 1) {
        this.paintCellText(r, c, this.opts.store.getCell(r, c));
      }
    }
  }

  private paintBackground(): void {
    this.ctx.fillStyle = getCssVar('--ss-bg', '#fff');
    this.ctx.fillRect(0, 0, this.getViewportWidth(), this.getViewportHeight());
  }

  private paintCellText(r: number, c: number, cell: Cell | undefined): void {
    if (cell === undefined || cell.text.length === 0) return;

    const { x, y } = this.scroller.cellToPixel(r, c);
    this.ctx.fillText(cell.text, x + 4 - this.scroller.scrollLeft, y + 5 - this.scroller.scrollTop);
  }

  private getViewportWidth(): number {
    return this.opts.canvas.clientWidth || this.opts.canvas.width || 300;
  }

  private getViewportHeight(): number {
    return this.opts.canvas.clientHeight || this.opts.canvas.height || 150;
  }
}

function getCssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;

  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}
