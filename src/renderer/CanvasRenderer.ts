import { num2alpha } from '../util/alphabet';
import { Range, type RangeAddress } from '../selection/Range';
import type { Store } from '../store/Store';
import { DirtyRegionTracker, type Rect } from './DirtyRegionTracker';
import { VirtualScroller, type VisibleRange } from './VirtualScroller';

export const TOTAL_ROWS = 1_000;
export const TOTAL_COLS = 26;
export const ROW_HEIGHT = 25;
export const COL_WIDTH = 100;
export const ROW_HEADER_WIDTH = 46;
export const COL_HEADER_HEIGHT = 25;

export interface CellAddress { readonly r: number; readonly c: number }
export interface CanvasRendererOptions {
  canvas: HTMLCanvasElement;
  store: Store;
  selectedRange?: RangeAddress;
  onCellClick?: (cell: CellAddress, shiftKey?: boolean) => void;
  onSelectionChange?: (range: RangeAddress) => void;
  onColumnSelect?: (c: number, shiftKey: boolean) => void;
  onRowSelect?: (r: number, shiftKey: boolean) => void;
  devicePixelRatio?: number;
}

interface CanvasTheme {
  readonly bg: string; readonly text: string; readonly grid: string; readonly selected: string;
  readonly headerBg: string; readonly accent: string; readonly fontFamily: string;
}

type HeaderHit = { type: 'column'; c: number } | { type: 'row'; r: number } | null;

// CanvasRenderer is kept in one file because it owns event binding and paint order.
export class CanvasRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly scroller: VirtualScroller;
  private readonly dirty = new DirtyRegionTracker();
  private readonly unsubscribe: () => void;
  private selectedRange: RangeAddress | undefined;
  private dragAnchor: CellAddress | null = null;
  private rafId: number | null = null;

  public constructor(private readonly opts: CanvasRendererOptions) {
    const ctx = opts.canvas.getContext('2d');
    if (ctx === null) throw new Error('Canvas 2D context not available');
    this.ctx = ctx;
    this.selectedRange = opts.selectedRange;
    this.scroller = new VirtualScroller({ totalRows: TOTAL_ROWS, totalCols: TOTAL_COLS, defaultRowHeight: ROW_HEIGHT, defaultColWidth: COL_WIDTH, viewportW: this.getGridWidth(), viewportH: this.getGridHeight() });
    this.unsubscribe = opts.store.subscribe(() => this.invalidateAll());
    this.setupCanvas();
    this.bindEvents();
    this.invalidateAll();
  }

  public destroy(): void {
    if (this.rafId !== null) window.cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.unsubscribe();
    this.unbindEvents();
  }

  public setSelectedRange(range: RangeAddress | undefined): void {
    this.selectedRange = range;
    this.invalidateAll();
  }

  public setSelectedCell(cell: CellAddress | undefined): void {
    this.setSelectedRange(cell === undefined ? undefined : Range.single(cell.r, cell.c).toAddress());
  }

  public invalidateAll(): void {
    this.dirty.invalidateAll();
    this.scheduleRender();
  }

  private bindEvents(): void {
    if (!this.opts.canvas.hasAttribute('tabindex')) this.opts.canvas.tabIndex = 0;
    this.opts.canvas.addEventListener('mousedown', this.handleMouseDown);
    window.addEventListener('mousemove', this.handleMouseMove);
    window.addEventListener('mouseup', this.handleMouseUp);
    window.addEventListener('ss:theme-changed', this.handleThemeChanged);
  }

  private unbindEvents(): void {
    this.opts.canvas.removeEventListener('mousedown', this.handleMouseDown);
    window.removeEventListener('mousemove', this.handleMouseMove);
    window.removeEventListener('mouseup', this.handleMouseUp);
    window.removeEventListener('ss:theme-changed', this.handleThemeChanged);
  }

  private readonly handleMouseDown = (event: MouseEvent): void => {
    const header = canvasPointToHeader(this.opts.canvas, event.clientX, event.clientY, this.scroller.scrollLeft, this.scroller.scrollTop);
    if (header?.type === 'column') { this.opts.onColumnSelect?.(header.c, event.shiftKey); return; }
    if (header?.type === 'row') { this.opts.onRowSelect?.(header.r, event.shiftKey); return; }
    const cell = this.pointerCell(event.clientX, event.clientY);
    if (cell === null) return;
    this.opts.canvas.focus();
    this.dragAnchor = cell;
    this.setSelectedCell(cell);
    if (event.shiftKey) this.opts.onCellClick?.(cell, true);
    else this.opts.onCellClick?.(cell);
  };

  private readonly handleMouseMove = (event: MouseEvent): void => {
    if (this.dragAnchor === null) return;
    const cell = this.pointerCell(event.clientX, event.clientY);
    if (cell === null) return;
    const range = new Range({ r1: this.dragAnchor.r, c1: this.dragAnchor.c, r2: cell.r, c2: cell.c }).toAddress();
    this.setSelectedRange(range);
    this.opts.onSelectionChange?.(range);
  };

  private readonly handleMouseUp = (): void => { this.dragAnchor = null; };
  private readonly handleThemeChanged = (): void => this.invalidateAll();

  private scheduleRender(): void {
    if (this.rafId !== null) return;
    this.rafId = window.requestAnimationFrame(() => { this.rafId = null; this.render(); });
  }

  private render(): void {
    if (this.dirty.isEmpty()) return;
    this.syncViewport();
    const theme = readCanvasTheme();
    const range = this.scroller.getVisibleRange();
    this.dirty.drain().forEach((region) => this.paintRegion(region, range, theme));
  }

  private syncViewport(): void {
    this.setupCanvas();
    this.scroller.setViewport(this.getGridWidth(), this.getGridHeight());
  }

  private setupCanvas(): void {
    const dpr = this.opts.devicePixelRatio ?? window.devicePixelRatio ?? 1;
    const width = this.getViewportWidth();
    const height = this.getViewportHeight();
    this.opts.canvas.width = Math.floor(width * dpr);
    this.opts.canvas.height = Math.floor(height * dpr);
    if (typeof this.ctx.setTransform === 'function') this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    else this.ctx.scale(dpr, dpr);
  }

  private paintRegion(region: Rect, range: VisibleRange, theme: CanvasTheme): void {
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.rect(region.x, region.y, region.w, region.h);
    this.ctx.clip();
    this.paintBackground(theme);
    this.paintHeaders(range, theme);
    this.paintGrid(range, theme);
    this.paintSelectionFill(range, theme);
    this.paintCellTexts(range, theme);
    this.paintSelectionBorder(theme);
    this.ctx.restore();
  }

  private paintBackground(theme: CanvasTheme): void {
    this.ctx.fillStyle = theme.bg;
    this.ctx.fillRect(0, 0, this.getViewportWidth(), this.getViewportHeight());
  }

  private paintHeaders(range: VisibleRange, theme: CanvasTheme): void {
    this.ctx.fillStyle = theme.headerBg;
    this.ctx.fillRect(0, 0, this.getViewportWidth(), COL_HEADER_HEIGHT);
    this.ctx.fillRect(0, 0, ROW_HEADER_WIDTH, this.getViewportHeight());
    this.ctx.strokeStyle = theme.grid;
    this.ctx.fillStyle = theme.text;
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.font = `12px ${theme.fontFamily}`;
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

  private paintGrid(range: VisibleRange, theme: CanvasTheme): void {
    this.ctx.strokeStyle = theme.grid;
    for (let r = range.startRow; r < range.endRow; r += 1) {
      for (let c = range.startCol; c < range.endCol; c += 1) this.strokeCell(r, c);
    }
  }

  private strokeCell(r: number, c: number): void {
    const { x, y } = this.cellToViewport(r, c);
    this.ctx.strokeRect(x, y, COL_WIDTH, ROW_HEIGHT);
  }

  private paintSelectionFill(visible: VisibleRange, theme: CanvasTheme): void {
    if (this.selectedRange === undefined) return;
    this.ctx.fillStyle = theme.selected;
    const range = new Range(this.selectedRange);
    for (let r = Math.max(range.r1, visible.startRow); r <= Math.min(range.r2, visible.endRow - 1); r += 1) {
      for (let c = Math.max(range.c1, visible.startCol); c <= Math.min(range.c2, visible.endCol - 1); c += 1) {
        const { x, y } = this.cellToViewport(r, c);
        this.ctx.fillRect(x + 1, y + 1, COL_WIDTH - 2, ROW_HEIGHT - 2);
      }
    }
  }

  private paintCellTexts(range: VisibleRange, theme: CanvasTheme): void {
    this.ctx.fillStyle = theme.text;
    this.ctx.textAlign = 'left';
    this.ctx.textBaseline = 'middle';
    this.ctx.font = `14px ${theme.fontFamily}`;
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

  private paintSelectionBorder(theme: CanvasTheme): void {
    if (this.selectedRange === undefined) return;
    const topLeft = this.cellToViewport(this.selectedRange.r1, this.selectedRange.c1);
    const w = (this.selectedRange.c2 - this.selectedRange.c1 + 1) * COL_WIDTH;
    const h = (this.selectedRange.r2 - this.selectedRange.r1 + 1) * ROW_HEIGHT;
    this.ctx.strokeStyle = theme.accent;
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(topLeft.x + 1, topLeft.y + 1, w - 2, h - 2);
    this.ctx.setLineDash?.([4, 3]);
    this.ctx.strokeRect(topLeft.x + 4, topLeft.y + 4, w - 8, h - 8);
    this.ctx.setLineDash?.([]);
    this.ctx.lineWidth = 1;
  }

  private pointerCell(clientX: number, clientY: number): CellAddress | null {
    return canvasPointToCell(this.opts.canvas, clientX, clientY, this.scroller.scrollLeft, this.scroller.scrollTop);
  }

  private cellToViewport(r: number, c: number): { x: number; y: number } {
    const pos = this.scroller.cellToPixel(r, c);
    return { x: ROW_HEADER_WIDTH + pos.x - this.scroller.scrollLeft, y: COL_HEADER_HEIGHT + pos.y - this.scroller.scrollTop };
  }

  private getGridWidth(): number { return Math.max(0, this.getViewportWidth() - ROW_HEADER_WIDTH); }
  private getGridHeight(): number { return Math.max(0, this.getViewportHeight() - COL_HEADER_HEIGHT); }
  private getViewportWidth(): number { return this.opts.canvas.clientWidth || this.opts.canvas.width || 300; }
  private getViewportHeight(): number { return this.opts.canvas.clientHeight || this.opts.canvas.height || 150; }
}

export function canvasPointToCell(canvas: HTMLCanvasElement, clientX: number, clientY: number, scrollLeft = 0, scrollTop = 0): CellAddress | null {
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left - ROW_HEADER_WIDTH + scrollLeft;
  const y = clientY - rect.top - COL_HEADER_HEIGHT + scrollTop;
  if (x < 0 || y < 0) return null;
  return { r: Math.floor(y / ROW_HEIGHT), c: Math.floor(x / COL_WIDTH) };
}

export function canvasPointToHeader(canvas: HTMLCanvasElement, clientX: number, clientY: number, scrollLeft = 0, scrollTop = 0): HeaderHit {
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  if (y >= 0 && y < COL_HEADER_HEIGHT && x >= ROW_HEADER_WIDTH) return { type: 'column', c: Math.floor((x - ROW_HEADER_WIDTH + scrollLeft) / COL_WIDTH) };
  if (x >= 0 && x < ROW_HEADER_WIDTH && y >= COL_HEADER_HEIGHT) return { type: 'row', r: Math.floor((y - COL_HEADER_HEIGHT + scrollTop) / ROW_HEIGHT) };
  return null;
}

function readCanvasTheme(): CanvasTheme {
  const styles = typeof document === 'undefined' ? null : getComputedStyle(document.documentElement);
  return { bg: cssVar(styles, '--ss-bg', '#fff'), text: cssVar(styles, '--ss-text', '#333'), grid: cssVar(styles, '--ss-grid', '#f0f0f0'), selected: cssVar(styles, '--ss-selected', '#e8f0ff'), headerBg: cssVar(styles, '--ss-header-bg', '#f7f7f7'), accent: cssVar(styles, '--ss-accent', '#1677ff'), fontFamily: cssVar(styles, '--ss-font-family', 'sans-serif') };
}

function cssVar(styles: CSSStyleDeclaration | null, name: string, fallback: string): string {
  return styles?.getPropertyValue(name).trim() || fallback;
}
