import { num2alpha } from '../util/alphabet';
import type { SelectionKind } from '../selection/Selection';
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
  selectionKind?: SelectionKind;
  activeCell?: CellAddress;
  zoom?: number;
  showGrid?: boolean;
  showFormula?: boolean;
  onCellClick?: (cell: CellAddress, shiftKey?: boolean) => void;
  onSelectionChange?: (range: RangeAddress, activeCell?: CellAddress, anchorCell?: CellAddress) => void;
  onColumnSelect?: (c: number, shiftKey: boolean) => void;
  onRowSelect?: (r: number, shiftKey: boolean) => void;
  onSheetSelect?: () => void;
  devicePixelRatio?: number;
}

interface CanvasTheme {
  readonly bg: string; readonly text: string; readonly grid: string; readonly selected: string;
  readonly headerBg: string; readonly accent: string; readonly fontFamily: string; readonly border: string;
}

type HeaderHit = { type: 'sheet' } | { type: 'column'; c: number } | { type: 'row'; r: number } | null;
type DragAnchor = { type: 'cell'; r: number; c: number } | { type: 'column'; c: number } | { type: 'row'; r: number };

// CanvasRenderer is kept in one file because it owns event binding and paint order.
export class CanvasRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly scroller: VirtualScroller;
  private readonly dirty = new DirtyRegionTracker();
  private readonly unsubscribe: () => void;
  private selectedRange: RangeAddress | undefined;
  private selectionKind: SelectionKind | undefined;
  private activeCell: CellAddress | undefined;
  private dragAnchor: DragAnchor | null = null;
  private rafId: number | null = null;

  public constructor(private readonly opts: CanvasRendererOptions) {
    const ctx = opts.canvas.getContext('2d');
    if (ctx === null) throw new Error('Canvas 2D context not available');
    this.ctx = ctx;
    this.selectedRange = opts.selectedRange;
    this.selectionKind = opts.selectionKind;
    this.activeCell = opts.activeCell;
    this.scroller = new VirtualScroller({ totalRows: TOTAL_ROWS, totalCols: TOTAL_COLS, defaultRowHeight: this.rowHeight(), defaultColWidth: this.colWidth(), viewportW: this.getGridWidth(), viewportH: this.getGridHeight() });
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

  public setSelection(range: RangeAddress | undefined, kind: SelectionKind | undefined, activeCell?: CellAddress): void {
    this.selectedRange = range;
    this.selectionKind = kind;
    this.activeCell = activeCell;
    this.invalidateAll();
  }

  public setSelectedCell(cell: CellAddress | undefined): void {
    this.setSelection(cell === undefined ? undefined : Range.single(cell.r, cell.c).toAddress(), cell === undefined ? undefined : 'cell', cell);
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
    const header = canvasPointToHeader(this.opts.canvas, event.clientX, event.clientY, this.scroller.scrollLeft, this.scroller.scrollTop, this.opts.zoom);
    if (header?.type === 'sheet') { this.opts.canvas.focus(); this.dragAnchor = null; this.opts.onSheetSelect?.(); return; }
    if (header?.type === 'column') { this.opts.canvas.focus(); this.dragAnchor = { type: 'column', c: header.c }; this.opts.onColumnSelect?.(header.c, event.shiftKey); return; }
    if (header?.type === 'row') { this.opts.canvas.focus(); this.dragAnchor = { type: 'row', r: header.r }; this.opts.onRowSelect?.(header.r, event.shiftKey); return; }
    const cell = this.pointerCell(event.clientX, event.clientY);
    if (cell === null) return;
    this.opts.canvas.focus();
    this.dragAnchor = { type: 'cell', ...cell };
    this.setSelectedCell(cell);
    if (event.shiftKey) this.opts.onCellClick?.(cell, true);
    else this.opts.onCellClick?.(cell);
  };

  private readonly handleMouseMove = (event: MouseEvent): void => {
    if (this.dragAnchor === null) return;
    if (this.dragAnchor.type === 'column') {
      const c = canvasPointToColumn(this.opts.canvas, event.clientX, this.scroller.scrollLeft, this.opts.zoom);
      if (c !== null) this.opts.onColumnSelect?.(c, true);
      return;
    }
    if (this.dragAnchor.type === 'row') {
      const r = canvasPointToRow(this.opts.canvas, event.clientY, this.scroller.scrollTop, this.opts.zoom);
      if (r !== null) this.opts.onRowSelect?.(r, true);
      return;
    }
    const cell = this.pointerCell(event.clientX, event.clientY);
    if (cell === null) return;
    const range = new Range({ r1: this.dragAnchor.r, c1: this.dragAnchor.c, r2: cell.r, c2: cell.c }).toAddress();
    this.setSelection(range, 'range', cell);
    this.opts.onSelectionChange?.(range, cell, { r: this.dragAnchor.r, c: this.dragAnchor.c });
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
    this.paintCellBackgrounds(range);
    this.paintGrid(range, theme);
    this.paintSelectionFill(range, theme);
    this.paintCellTexts(range);
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
    this.ctx.strokeStyle = theme.border;
    this.ctx.fillStyle = theme.text;
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.font = `${Math.max(12, Math.round(12 * this.zoom()))}px ${theme.fontFamily}`;
    this.paintColumnHeaders(range, theme);
    this.paintRowHeaders(range, theme);
  }

  private paintColumnHeaders(range: VisibleRange, theme: CanvasTheme): void {
    for (let c = range.startCol; c < range.endCol; c += 1) {
      const x = ROW_HEADER_WIDTH + c * this.colWidth() - this.scroller.scrollLeft;
      if (this.isHighlightedColumn(c)) {
        this.ctx.fillStyle = headerSelectionColor(theme);
        this.ctx.fillRect(x + 1, 1, this.colWidth() - 2, COL_HEADER_HEIGHT - 2);
        this.ctx.fillStyle = theme.text;
      }
      this.ctx.strokeRect(x, 0, this.colWidth(), COL_HEADER_HEIGHT);
      this.ctx.fillText(num2alpha(c), x + this.colWidth() / 2, COL_HEADER_HEIGHT / 2);
    }
  }

  private paintRowHeaders(range: VisibleRange, theme: CanvasTheme): void {
    for (let r = range.startRow; r < range.endRow; r += 1) {
      const y = COL_HEADER_HEIGHT + r * this.rowHeight() - this.scroller.scrollTop;
      if (this.isHighlightedRow(r)) {
        this.ctx.fillStyle = headerSelectionColor(theme);
        this.ctx.fillRect(1, y + 1, ROW_HEADER_WIDTH - 2, this.rowHeight() - 2);
        this.ctx.fillStyle = theme.text;
      }
      this.ctx.strokeRect(0, y, ROW_HEADER_WIDTH, this.rowHeight());
      this.ctx.fillText(String(r + 1), ROW_HEADER_WIDTH / 2, y + this.rowHeight() / 2);
    }
  }

  private paintGrid(range: VisibleRange, theme: CanvasTheme): void {
    if (this.opts.showGrid === false) return;
    this.ctx.strokeStyle = theme.grid;
    for (let r = range.startRow; r < range.endRow; r += 1) {
      for (let c = range.startCol; c < range.endCol; c += 1) this.strokeCell(r, c);
    }
  }

  private paintCellBackgrounds(range: VisibleRange): void {
    for (let r = range.startRow; r < range.endRow; r += 1) {
      for (let c = range.startCol; c < range.endCol; c += 1) this.paintCellBackground(r, c);
    }
  }

  private paintCellBackground(r: number, c: number): void {
    const style = this.cellStyle(r, c);
    if (style?.bgcolor === undefined) return;
    const { x, y } = this.cellToViewport(r, c);
    this.ctx.fillStyle = style.bgcolor;
    this.ctx.fillRect(x + 1, y + 1, this.colWidth() - 2, this.rowHeight() - 2);
  }

  private strokeCell(r: number, c: number): void {
    const { x, y } = this.cellToViewport(r, c);
    this.ctx.strokeRect(x, y, this.colWidth(), this.rowHeight());
  }

  private paintSelectionFill(visible: VisibleRange, theme: CanvasTheme): void {
    if (this.selectedRange === undefined) return;
    this.ctx.fillStyle = theme.selected;
    const range = new Range(this.selectedRange);
    for (let r = Math.max(range.r1, visible.startRow); r <= Math.min(range.r2, visible.endRow - 1); r += 1) {
      for (let c = Math.max(range.c1, visible.startCol); c <= Math.min(range.c2, visible.endCol - 1); c += 1) {
        if (this.isActiveCell(r, c) && this.selectionKind !== 'row' && this.selectionKind !== 'column' && this.selectionKind !== 'sheet') continue;
        const { x, y } = this.cellToViewport(r, c);
        this.ctx.fillRect(x + 1, y + 1, this.colWidth() - 2, this.rowHeight() - 2);
      }
    }
  }

  private paintCellTexts(range: VisibleRange): void {
    for (let r = range.startRow; r < range.endRow; r += 1) {
      for (let c = range.startCol; c < range.endCol; c += 1) this.paintCellText(r, c);
    }
  }

  private paintCellText(r: number, c: number): void {
    const cell = this.opts.store.getCell(r, c);
    if (cell === undefined || cell.text.length === 0) return;
    const style = this.cellStyle(r, c);
    const fontSize = Math.max(10, Math.round((style?.fontSize ?? 14) * this.zoom()));
    const fontFamily = style?.fontFamily ?? readCanvasTheme().fontFamily;
    const text = this.opts.showFormula === true && cell.formula !== undefined ? cell.formula : cell.text;
    const align = style?.align ?? 'left';
    const { x, y } = this.cellToViewport(r, c);
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.rect(x + 1, y + 1, this.colWidth() - 2, this.rowHeight() - 2);
    this.ctx.clip();
    this.ctx.fillStyle = style?.color ?? readCanvasTheme().text;
    this.ctx.textBaseline = 'middle';
    this.ctx.textAlign = align;
    this.ctx.font = `${style?.italic === true ? 'italic ' : ''}${style?.bold === true ? 'bold ' : ''}${fontSize}px ${fontFamily}`;
    const textX = align === 'center' ? x + this.colWidth() / 2 : align === 'right' ? x + this.colWidth() - 6 : x + 6;
    const textY = y + this.rowHeight() / 2;
    this.ctx.fillText(text, textX, textY);
    if (style?.underline === true) this.paintUnderline(text, textX, textY, align, fontSize);
    this.ctx.restore();
  }

  private paintUnderline(text: string, x: number, y: number, align: 'left' | 'center' | 'right', fontSize: number): void {
    const width = typeof this.ctx.measureText === 'function' ? this.ctx.measureText(text).width : text.length * fontSize * 0.6;
    const start = align === 'center' ? x - width / 2 : align === 'right' ? x - width : x;
    this.ctx.beginPath();
    this.ctx.moveTo(start, y + fontSize * 0.38);
    this.ctx.lineTo(start + width, y + fontSize * 0.38);
    this.ctx.strokeStyle = String(this.ctx.fillStyle);
    this.ctx.lineWidth = 1;
    this.ctx.stroke();
  }

  private paintSelectionBorder(theme: CanvasTheme): void {
    if (this.selectedRange === undefined) return;
    const topLeft = this.cellToViewport(this.selectedRange.r1, this.selectedRange.c1);
    const w = (this.selectedRange.c2 - this.selectedRange.c1 + 1) * this.colWidth();
    const h = (this.selectedRange.r2 - this.selectedRange.r1 + 1) * this.rowHeight();
    this.ctx.strokeStyle = theme.accent;
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(topLeft.x + 1, topLeft.y + 1, w - 2, h - 2);
    this.paintActiveCellBorder(theme);
    this.ctx.fillStyle = theme.accent;
    this.ctx.fillRect(topLeft.x + w - 5, topLeft.y + h - 5, 7, 7);
    this.ctx.lineWidth = 1;
  }

  private paintActiveCellBorder(theme: CanvasTheme): void {
    if (this.activeCell === undefined || this.selectedRange === undefined) return;
    if (!new Range(this.selectedRange).contains(this.activeCell.r, this.activeCell.c)) return;
    if (this.selectionKind === 'row' || this.selectionKind === 'column' || this.selectionKind === 'sheet') return;
    const { x, y } = this.cellToViewport(this.activeCell.r, this.activeCell.c);
    this.ctx.strokeStyle = theme.accent;
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(x + 1, y + 1, this.colWidth() - 2, this.rowHeight() - 2);
  }

  private isHighlightedColumn(c: number): boolean {
    if (this.selectedRange === undefined) return false;
    if (this.selectionKind === 'row') return false;
    return c >= this.selectedRange.c1 && c <= this.selectedRange.c2;
  }

  private isHighlightedRow(r: number): boolean {
    if (this.selectedRange === undefined) return false;
    if (this.selectionKind === 'column') return false;
    return r >= this.selectedRange.r1 && r <= this.selectedRange.r2;
  }

  private isActiveCell(r: number, c: number): boolean {
    return this.activeCell !== undefined && this.activeCell.r === r && this.activeCell.c === c;
  }

  private pointerCell(clientX: number, clientY: number): CellAddress | null {
    return canvasPointToCell(this.opts.canvas, clientX, clientY, this.scroller.scrollLeft, this.scroller.scrollTop, this.opts.zoom);
  }

  private cellToViewport(r: number, c: number): { x: number; y: number } {
    const pos = this.scroller.cellToPixel(r, c);
    return { x: ROW_HEADER_WIDTH + pos.x - this.scroller.scrollLeft, y: COL_HEADER_HEIGHT + pos.y - this.scroller.scrollTop };
  }

  private cellStyle(r: number, c: number) {
    const cell = this.opts.store.getCell(r, c);
    return cell?.styleId === undefined ? undefined : this.opts.store.getStyle(cell.styleId);
  }

  private zoom(): number {
    return (this.opts.zoom ?? 100) / 100;
  }

  private rowHeight(): number {
    return ROW_HEIGHT * this.zoom();
  }

  private colWidth(): number {
    return COL_WIDTH * this.zoom();
  }

  private getGridWidth(): number { return Math.max(0, this.getViewportWidth() - ROW_HEADER_WIDTH); }
  private getGridHeight(): number { return Math.max(0, this.getViewportHeight() - COL_HEADER_HEIGHT); }
  private getViewportWidth(): number { return this.opts.canvas.clientWidth || this.opts.canvas.width || 300; }
  private getViewportHeight(): number { return this.opts.canvas.clientHeight || this.opts.canvas.height || 150; }
}

export function canvasPointToCell(canvas: HTMLCanvasElement, clientX: number, clientY: number, scrollLeft = 0, scrollTop = 0, zoom = 100): CellAddress | null {
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left - ROW_HEADER_WIDTH + scrollLeft;
  const y = clientY - rect.top - COL_HEADER_HEIGHT + scrollTop;
  const scale = zoom / 100;
  if (x < 0 || y < 0) return null;
  return { r: Math.floor(y / (ROW_HEIGHT * scale)), c: Math.floor(x / (COL_WIDTH * scale)) };
}

export function canvasPointToHeader(canvas: HTMLCanvasElement, clientX: number, clientY: number, scrollLeft = 0, scrollTop = 0, zoom = 100): HeaderHit {
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const c = canvasPointToColumn(canvas, clientX, scrollLeft, zoom);
  const r = canvasPointToRow(canvas, clientY, scrollTop, zoom);
  if (x >= 0 && x < ROW_HEADER_WIDTH && y >= 0 && y < COL_HEADER_HEIGHT) return { type: 'sheet' };
  if (y >= 0 && y < COL_HEADER_HEIGHT && c !== null) return { type: 'column', c };
  if (x >= 0 && x < ROW_HEADER_WIDTH && r !== null) return { type: 'row', r };
  return null;
}

export function canvasPointToColumn(canvas: HTMLCanvasElement, clientX: number, scrollLeft = 0, zoom = 100): number | null {
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left - ROW_HEADER_WIDTH + scrollLeft;
  const scale = zoom / 100;
  if (x < 0) return null;
  return clamp(Math.floor(x / (COL_WIDTH * scale)), 0, TOTAL_COLS - 1);
}

export function canvasPointToRow(canvas: HTMLCanvasElement, clientY: number, scrollTop = 0, zoom = 100): number | null {
  const rect = canvas.getBoundingClientRect();
  const y = clientY - rect.top - COL_HEADER_HEIGHT + scrollTop;
  const scale = zoom / 100;
  if (y < 0) return null;
  return clamp(Math.floor(y / (ROW_HEIGHT * scale)), 0, TOTAL_ROWS - 1);
}

function readCanvasTheme(): CanvasTheme {
  const styles = typeof document === 'undefined' ? null : getComputedStyle(document.documentElement);
  return { bg: cssVar(styles, '--ss-bg', '#fff'), text: cssVar(styles, '--ss-text', '#333'), grid: cssVar(styles, '--ss-grid', '#f0f0f0'), selected: cssVar(styles, '--ss-selected', '#e8f0ff'), headerBg: cssVar(styles, '--ss-header-bg', '#f7f7f7'), accent: cssVar(styles, '--ss-accent', '#1677ff'), fontFamily: cssVar(styles, '--ss-font-family', 'sans-serif'), border: cssVar(styles, '--ss-border', '#d9d9d9') };
}

function headerSelectionColor(theme: CanvasTheme): string {
  return typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('color', 'color-mix(in srgb, #000 10%, white)')
    ? `color-mix(in srgb, ${theme.accent} 14%, ${theme.headerBg})`
    : theme.selected;
}

function cssVar(styles: CSSStyleDeclaration | null, name: string, fallback: string): string {
  return styles?.getPropertyValue(name).trim() || fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
