import type { Store } from '../store/Store';
import { num2alpha } from '../util/alphabet';
import { DirtyRegionTracker, type Rect } from './DirtyRegionTracker';
import { VirtualScroller, type VisibleRange } from './VirtualScroller';

const TOTAL_ROWS = 1_000;
const TOTAL_COLS = 26;
const ROW_HEIGHT = 25;
const COL_WIDTH = 100;
const ROW_HEADER_WIDTH = 46;
const COL_HEADER_HEIGHT = 25;

export interface CellAddress {
  readonly r: number;
  readonly c: number;
}

export interface CanvasRendererOptions {
  canvas: HTMLCanvasElement;
  store: Store;
  selectedCell?: CellAddress;
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
      totalRows: TOTAL_ROWS,
      totalCols: TOTAL_COLS,
      defaultRowHeight: ROW_HEIGHT,
      defaultColWidth: COL_WIDTH,
      viewportW: this.getGridWidth(),
      viewportH: this.getGridHeight(),
    });
    this.unsubscribe = opts.store.subscribe(() => this.onStoreChange());
    this.setupCanvas();
    this.dirty.invalidateAll();
    this.scheduleRender();
  }

  public destroy(): void {
    if (this.rafId !== null) window.cancelAnimationFrame(this.rafId);
    this.rafId = null;
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

    this.syncViewport();
    const regions = this.dirty.drain();
    const range = this.scroller.getVisibleRange();
    regions.forEach((region) => this.paintRegion(region, range));
  }

  private syncViewport(): void {
    this.setupCanvas();
    this.scroller.setViewport(this.getGridWidth(), this.getGridHeight());
  }

  private paintRegion(region: Rect, range: VisibleRange): void {
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.rect(region.x, region.y, region.w, region.h);
    this.ctx.clip();
    this.paintBackground();
    this.paintHeaders(range);
    this.paintGrid(range);
    this.paintCellTexts(range);
    this.paintSelection();
    this.ctx.restore();
  }

  private paintBackground(): void {
    this.ctx.fillStyle = getCssVar('--ss-bg', '#fff');
    this.ctx.fillRect(0, 0, this.getViewportWidth(), this.getViewportHeight());
  }

  private paintHeaders(range: VisibleRange): void {
    this.ctx.fillStyle = getCssVar('--ss-header-bg', '#f7f7f7');
    this.ctx.fillRect(0, 0, this.getViewportWidth(), COL_HEADER_HEIGHT);
    this.ctx.fillRect(0, 0, ROW_HEADER_WIDTH, this.getViewportHeight());
    this.ctx.strokeStyle = getCssVar('--ss-grid', '#f0f0f0');
    this.ctx.fillStyle = getCssVar('--ss-text', '#333');
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.font = `12px ${getCssVar('--ss-font-family', 'sans-serif')}`;
    this.paintColumnHeaders(range);
    this.paintRowHeaders(range);
  }

  private paintColumnHeaders(range: VisibleRange): void {
    for (let c = range.startCol; c < range.endCol; c += 1) {
      const x = ROW_HEADER_WIDTH + c * COL_WIDTH - this.scroller.scrollLeft;
      this.ctx.strokeRect(x, 0, COL_WIDTH, COL_HEADER_HEIGHT);
      this.ctx.fillText(num2alpha(c), x + COL_WIDTH / 2, COL_HEADER_HEIGHT / 2);
    }
  }

  private paintRowHeaders(range: VisibleRange): void {
    for (let r = range.startRow; r < range.endRow; r += 1) {
      const y = COL_HEADER_HEIGHT + r * ROW_HEIGHT - this.scroller.scrollTop;
      this.ctx.strokeRect(0, y, ROW_HEADER_WIDTH, ROW_HEIGHT);
      this.ctx.fillText(String(r + 1), ROW_HEADER_WIDTH / 2, y + ROW_HEIGHT / 2);
    }
  }

  private paintGrid(range: VisibleRange): void {
    this.ctx.strokeStyle = getCssVar('--ss-grid', '#f0f0f0');
    for (let r = range.startRow; r < range.endRow; r += 1) {
      for (let c = range.startCol; c < range.endCol; c += 1) this.strokeCell(r, c);
    }
  }

  private strokeCell(r: number, c: number): void {
    const { x, y } = this.cellToViewport(r, c);
    this.ctx.strokeRect(x, y, COL_WIDTH, ROW_HEIGHT);
  }

  private paintCellTexts(range: VisibleRange): void {
    this.ctx.fillStyle = getCssVar('--ss-text', '#333');
    this.ctx.textAlign = 'left';
    this.ctx.textBaseline = 'middle';
    this.ctx.font = `14px ${getCssVar('--ss-font-family', 'sans-serif')}`;

    for (let r = range.startRow; r < range.endRow; r += 1) {
      for (let c = range.startCol; c < range.endCol; c += 1) this.paintCellText(r, c);
    }
  }

  private paintCellText(r: number, c: number): void {
    const cell = this.opts.store.getCell(r, c);
    if (cell === undefined || cell.text.length === 0) return;

    const { x, y } = this.cellToViewport(r, c);
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.rect(x + 1, y + 1, COL_WIDTH - 2, ROW_HEIGHT - 2);
    this.ctx.clip();
    this.ctx.fillText(cell.text, x + 6, y + ROW_HEIGHT / 2);
    this.ctx.restore();
  }

  private paintSelection(): void {
    const selected = this.opts.selectedCell;
    if (selected === undefined) return;

    const { x, y } = this.cellToViewport(selected.r, selected.c);
    this.ctx.strokeStyle = getCssVar('--ss-accent', '#1677ff');
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(x + 1, y + 1, COL_WIDTH - 2, ROW_HEIGHT - 2);
    this.ctx.lineWidth = 1;
  }

  private cellToViewport(r: number, c: number): { x: number; y: number } {
    const pos = this.scroller.cellToPixel(r, c);
    return { x: ROW_HEADER_WIDTH + pos.x - this.scroller.scrollLeft, y: COL_HEADER_HEIGHT + pos.y - this.scroller.scrollTop };
  }

  private getGridWidth(): number {
    return Math.max(0, this.getViewportWidth() - ROW_HEADER_WIDTH);
  }

  private getGridHeight(): number {
    return Math.max(0, this.getViewportHeight() - COL_HEADER_HEIGHT);
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
