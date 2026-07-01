import { num2alpha } from '../util/alphabet';
import type { SelectionKind } from '../selection/Selection';
import { Range, type RangeAddress } from '../selection/Range';
import type { Store } from '../store/Store';
import { TOTAL_ROWS, TOTAL_COLS, ROW_HEIGHT, COL_WIDTH, ROW_HEADER_WIDTH, COL_HEADER_HEIGHT, type CellAddress, canvasPointToCell, canvasPointToHeader, canvasPointToColumn, canvasPointToRow, type CanvasTheme, readCanvasTheme, headerSelectionColor } from './coordinate';
import { DirtyRegionTracker, type Rect } from './DirtyRegionTracker';
import { FillHandle } from '../fill/FillHandle';
import { FreezeManager } from '../freeze/FreezeManager';
import { ResizeHandler } from './ResizeHandler';
import { VirtualScroller, type VisibleRange } from './VirtualScroller';
import type { StoreEvent } from '../types';
import { parseRange } from '../util/cell';
import { formatValue } from '../format/NumberFormatter';
import { ConditionalService } from '../conditional/ConditionalService';

export { TOTAL_ROWS, TOTAL_COLS, ROW_HEIGHT, COL_WIDTH, ROW_HEADER_WIDTH, COL_HEADER_HEIGHT, canvasPointToCell, canvasPointToHeader, canvasPointToColumn, canvasPointToRow, type CellAddress };

export interface CanvasRendererOptions {
  canvas: HTMLCanvasElement; store: Store; selectedRange?: RangeAddress; selectionKind?: SelectionKind;
  activeCell?: CellAddress; zoom?: number; showGrid?: boolean; showFormula?: boolean;
  frozenRows?: number; frozenCols?: number;
  onCellClick?: (cell: CellAddress, shiftKey?: boolean) => void;
  onSelectionChange?: (range: RangeAddress, activeCell?: CellAddress, anchorCell?: CellAddress) => void;
  onColumnSelect?: (c: number, shiftKey: boolean) => void; onRowSelect?: (r: number, shiftKey: boolean) => void;
  onSheetSelect?: () => void; onRowResize?: (r: number, height: number) => void; onColResize?: (c: number, width: number) => void;
  onRowDblClick?: (r: number) => void; onColDblClick?: (c: number) => void;
  onFill?: (source: RangeAddress, target: RangeAddress, ctrlKey: boolean) => void; devicePixelRatio?: number;
  onHeaderContextMenu?: (info: { type: 'row'; r: number } | { type: 'column'; c: number }, x: number, y: number) => void;
}

type DragAnchor = { type: 'cell'; r: number; c: number } | { type: 'column'; c: number } | { type: 'row'; r: number };

export class CanvasRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly scroller: VirtualScroller;
  private readonly dirty = new DirtyRegionTracker();
  private readonly freeze: FreezeManager;
  private readonly resizeHandler: ResizeHandler;
  private readonly fillHandle: FillHandle;
  private readonly unsubscribe: () => void;
  private readonly conditionalService = new ConditionalService();
  private selectedRange: RangeAddress | undefined;
  private selectionKind: SelectionKind | undefined;
  private activeCell: CellAddress | undefined;
  private dragAnchor: DragAnchor | null = null;
  private rafId: number | null = null;
  private highlightMatches: readonly CellAddress[] = [];

  public constructor(private readonly opts: CanvasRendererOptions) {
    const ctx = opts.canvas.getContext('2d');
    if (ctx === null) throw new Error('Canvas 2D context not available');
    this.ctx = ctx;
    this.selectedRange = opts.selectedRange; this.selectionKind = opts.selectionKind; this.activeCell = opts.activeCell;
    this.scroller = new VirtualScroller({ totalRows: TOTAL_ROWS, totalCols: TOTAL_COLS, defaultRowHeight: this.defaultRowHeight(), defaultColWidth: this.defaultColWidth(), viewportW: this.gridW(), viewportH: this.gridH() });
    this.freeze = new FreezeManager({ totalRows: TOTAL_ROWS, totalCols: TOTAL_COLS });
    if ((opts.frozenRows ?? 0) > 0 || (opts.frozenCols ?? 0) > 0) this.freeze.freezeAt(opts.frozenRows ?? 0, opts.frozenCols ?? 0);
    this.syncSizesFromStore();
    this.resizeHandler = new ResizeHandler({ canvas: opts.canvas, scroller: this.scroller, store: opts.store, zoom: () => this.zoom(), onRowResize: opts.onRowResize, onColResize: opts.onColResize, onRowDblClick: opts.onRowDblClick, onColDblClick: opts.onColDblClick, invalidate: () => this.invalidateAll() });
    this.fillHandle = new FillHandle({ canvas: opts.canvas, scroller: this.scroller, selectedRange: () => this.selectedRange, onFill: opts.onFill, invalidate: () => this.invalidateAll() });
    this.unsubscribe = opts.store.subscribe((e: StoreEvent) => this.onStoreEvent(e));
    this.setupCanvas(); this.bindEvents(); this.invalidateAll();
  }

  public destroy(): void {
    if (this.rafId !== null) window.cancelAnimationFrame(this.rafId);
    this.rafId = null; this.resizeHandler.destroy(); this.fillHandle.destroy(); this.unsubscribe(); this.unbindEvents();
  }
  public setSelectedRange(range: RangeAddress | undefined): void { this.selectedRange = range; this.invalidateAll(); }
  public setSelection(range: RangeAddress | undefined, kind: SelectionKind | undefined, activeCell?: CellAddress): void { this.selectedRange = range; this.selectionKind = kind; this.activeCell = activeCell; this.invalidateAll(); }
  public setSelectedCell(cell: CellAddress | undefined): void { this.setSelection(cell === undefined ? undefined : Range.single(cell.r, cell.c).toAddress(), cell === undefined ? undefined : 'cell', cell); }
  public invalidateAll(): void { this.dirty.invalidateAll(); this.scheduleRender(); }
  public setFreeze(rows: number, cols: number): void { this.freeze.freezeAt(rows, cols); this.invalidateAll(); }
  public setHighlightMatches(cells: readonly CellAddress[]): void { this.highlightMatches = cells; this.invalidateAll(); }

  private bindEvents(): void {
    if (!this.opts.canvas.hasAttribute('tabindex')) this.opts.canvas.tabIndex = 0;
    const c = this.opts.canvas;
    c.addEventListener('mousedown', this.handleMouseDown); c.addEventListener('dblclick', this.handleDblClick); c.addEventListener('contextmenu', this.handleContextMenu);
    window.addEventListener('mousemove', this.handleMouseMove); window.addEventListener('mouseup', this.handleMouseUp);
    window.addEventListener('ss:theme-changed', this.handleThemeChanged);
  }
  private unbindEvents(): void {
    const c = this.opts.canvas;
    c.removeEventListener('mousedown', this.handleMouseDown); c.removeEventListener('dblclick', this.handleDblClick); c.removeEventListener('contextmenu', this.handleContextMenu);
    window.removeEventListener('mousemove', this.handleMouseMove); window.removeEventListener('mouseup', this.handleMouseUp);
    window.removeEventListener('ss:theme-changed', this.handleThemeChanged);
  }

  private readonly handleMouseDown = (ev: MouseEvent): void => {
    if (this.resizeHandler.onMouseDown(ev)) return;
    if (this.fillHandle.onMouseDown(ev)) { this.dragAnchor = null; return; }
    const h = canvasPointToHeader(this.opts.canvas, ev.clientX, ev.clientY, this.scroller.scrollLeft, this.scroller.scrollTop, this.opts.zoom);
    if (h?.type === 'sheet') { this.opts.canvas.focus(); this.dragAnchor = null; this.opts.onSheetSelect?.(); return; }
    if (h?.type === 'column') { this.opts.canvas.focus(); this.dragAnchor = { type: 'column', c: h.c }; this.opts.onColumnSelect?.(h.c, ev.shiftKey); return; }
    if (h?.type === 'row') { this.opts.canvas.focus(); this.dragAnchor = { type: 'row', r: h.r }; this.opts.onRowSelect?.(h.r, ev.shiftKey); return; }
    const cell = this.pointerCell(ev.clientX, ev.clientY); if (cell === null) return;
    this.opts.canvas.focus(); this.dragAnchor = { type: 'cell', ...cell }; this.setSelectedCell(cell);
    ev.shiftKey ? this.opts.onCellClick?.(cell, true) : this.opts.onCellClick?.(cell);
  };
  private readonly handleMouseMove = (ev: MouseEvent): void => {
    if (this.resizeHandler.isResizing()) { this.resizeHandler.onMouseMove(ev); return; }
    if (this.fillHandle.isDragging()) { this.fillHandle.onMouseMove(ev); return; }
    this.resizeHandler.onMouseMove(ev); this.fillHandle.onMouseMove(ev);
    if (this.dragAnchor === null) return;
    if (this.dragAnchor.type === 'column') { const c = canvasPointToColumn(this.opts.canvas, ev.clientX, this.scroller.scrollLeft, this.opts.zoom); if (c !== null) this.opts.onColumnSelect?.(c, true); return; }
    if (this.dragAnchor.type === 'row') { const r = canvasPointToRow(this.opts.canvas, ev.clientY, this.scroller.scrollTop, this.opts.zoom); if (r !== null) this.opts.onRowSelect?.(r, true); return; }
    const cell = this.pointerCell(ev.clientX, ev.clientY); if (cell === null) return;
    const range = new Range({ r1: this.dragAnchor.r, c1: this.dragAnchor.c, r2: cell.r, c2: cell.c }).toAddress();
    this.setSelection(range, 'range', cell); this.opts.onSelectionChange?.(range, cell, { r: this.dragAnchor.r, c: this.dragAnchor.c });
  };
  private readonly handleMouseUp = (): void => { if (this.resizeHandler.isResizing()) { this.resizeHandler.onMouseUp(); return; } if (this.fillHandle.isDragging()) { this.fillHandle.onMouseUp(); return; } this.dragAnchor = null; };
  private readonly handleDblClick = (ev: MouseEvent): void => { if (this.resizeHandler.onDblClick(ev)) ev.stopPropagation(); };
  private readonly handleThemeChanged = (): void => this.invalidateAll();
  private readonly handleContextMenu = (ev: MouseEvent): void => {
    ev.preventDefault();
    const h = canvasPointToHeader(this.opts.canvas, ev.clientX, ev.clientY, this.scroller.scrollLeft, this.scroller.scrollTop, this.opts.zoom);
    if (h?.type === 'row') this.opts.onHeaderContextMenu?.({ type: 'row', r: h.r }, ev.clientX, ev.clientY);
    else if (h?.type === 'column') this.opts.onHeaderContextMenu?.({ type: 'column', c: h.c }, ev.clientX, ev.clientY);
  };

  private scheduleRender(): void { if (this.rafId !== null) return; this.rafId = window.requestAnimationFrame(() => { this.rafId = null; this.render(); }); }
  private render(): void { if (this.dirty.isEmpty()) return; this.syncViewport(); const theme = readCanvasTheme(); const vis = this.scroller.getVisibleRange(); this.dirty.drain().forEach((r) => this.paintRegion(r, vis, theme)); }
  private syncViewport(): void { this.setupCanvas(); this.scroller.setViewport(this.gridW(), this.gridH()); }
  private setupCanvas(): void { const dpr = this.opts.devicePixelRatio ?? window.devicePixelRatio ?? 1; this.opts.canvas.width = Math.floor(this.vpW() * dpr); this.opts.canvas.height = Math.floor(this.vpH() * dpr); if (typeof this.ctx.setTransform === 'function') this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0); else this.ctx.scale(dpr, dpr); }

  private paintRegion(region: Rect, vis: VisibleRange, theme: CanvasTheme): void {
    this.ctx.save(); this.ctx.beginPath(); this.ctx.rect(region.x, region.y, region.w, region.h); this.ctx.clip();
    this.ctx.fillStyle = theme.bg; this.ctx.fillRect(0, 0, this.vpW(), this.vpH());
    this.paintHeaders(vis, theme); this.paintCells(vis, theme); this.paintSelection(theme); this.paintOverlays(theme);
    if (this.freeze.isFrozen()) this.paintFrozenPanes(vis, theme);
    this.ctx.restore();
  }

  private paintHeaders(vis: VisibleRange, theme: CanvasTheme): void {
    this.ctx.fillStyle = theme.headerBg; this.ctx.fillRect(0, 0, this.vpW(), COL_HEADER_HEIGHT); this.ctx.fillRect(0, 0, ROW_HEADER_WIDTH, this.vpH());
    this.ctx.strokeStyle = theme.border; this.ctx.fillStyle = theme.text; this.ctx.textAlign = 'center'; this.ctx.textBaseline = 'middle';
    this.ctx.font = `${Math.max(12, Math.round(12 * this.zoom()))}px ${theme.fontFamily}`;
    let x = ROW_HEADER_WIDTH - this.scroller.scrollLeft; for (let i = 0; i < vis.startCol; i += 1) x += this.scroller.getColWidth(i);
    for (let c = vis.startCol; c < vis.endCol; c += 1) { const w = this.scroller.getColWidth(c); if (this.isHighCol(c)) { this.ctx.fillStyle = headerSelectionColor(theme); this.ctx.fillRect(x + 1, 1, w - 2, COL_HEADER_HEIGHT - 2); this.ctx.fillStyle = theme.text; } this.ctx.strokeRect(x, 0, w, COL_HEADER_HEIGHT); this.ctx.fillText(num2alpha(c), x + w / 2, COL_HEADER_HEIGHT / 2); x += w; }
    let y = COL_HEADER_HEIGHT - this.scroller.scrollTop; for (let i = 0; i < vis.startRow; i += 1) y += this.scroller.getRowHeight(i);
    for (let r = vis.startRow; r < vis.endRow; r += 1) { const h = this.scroller.getRowHeight(r); if (this.isHighRow(r)) { this.ctx.fillStyle = headerSelectionColor(theme); this.ctx.fillRect(1, y + 1, ROW_HEADER_WIDTH - 2, h - 2); this.ctx.fillStyle = theme.text; } this.ctx.strokeRect(0, y, ROW_HEADER_WIDTH, h); this.ctx.fillText(String(r + 1), ROW_HEADER_WIDTH / 2, y + h / 2); y += h; }
  }

  private paintCells(vis: VisibleRange, theme: CanvasTheme): void {
    const skip = this.mergeSkipSet(vis);
    for (let r = vis.startRow; r < vis.endRow; r += 1) {
      for (let c = vis.startCol; c < vis.endCol; c += 1) {
        if (skip.has(`${r},${c}`)) continue;
        const merge = this.opts.store.getMergeAt(r, c);
        if (merge !== undefined) { const mr = parseRange(merge); const rect = this.rangeRect(mr); this.paintCellBg(mr.r1, mr.c1, rect.x, rect.y, rect.w, rect.h, theme); continue; }
        const { x, y } = this.cellVP(r, c); this.paintCellBg(r, c, x, y, this.scroller.getColWidth(c), this.scroller.getRowHeight(r), theme);
      }
    }
  }

  private paintCellBg(r: number, c: number, x: number, y: number, cw: number, rh: number, theme: CanvasTheme): void {
    const style = this.cellStyle(r, c);
    const overlay = this.conditionalService.computeOverlay(this.opts.store, r, c);
    const merged = { ...style, ...overlay.style };
    if (merged.bgcolor !== undefined) { this.ctx.fillStyle = merged.bgcolor; this.ctx.fillRect(x + 1, y + 1, cw - 2, rh - 2); }
    if (overlay.dataBar !== undefined) { this.paintDataBar(x, y, cw, rh, overlay.dataBar.ratio, overlay.dataBar.color); }
    if (this.opts.showGrid !== false) { this.ctx.strokeStyle = theme.grid; this.ctx.strokeRect(x, y, cw, rh); }
    if (this.isSelFill(r, c)) { this.ctx.fillStyle = theme.selected; this.ctx.fillRect(x + 1, y + 1, cw - 2, rh - 2); }
    this.paintTextWith(r, c, x, y, cw, rh, theme, merged);
  }

  private paintDataBar(x: number, y: number, cw: number, rh: number, ratio: number, color: string): void {
    const barW = Math.max(0, (cw - 2) * ratio);
    this.ctx.save();
    this.ctx.globalAlpha = 0.4;
    this.ctx.fillStyle = color;
    this.ctx.fillRect(x + 1, y + 1, barW, rh - 2);
    this.ctx.globalAlpha = 1;
    this.ctx.restore();
  }

  private mergeSkipSet(vis: VisibleRange): Set<string> {
    const skip = new Set<string>();
    for (const m of this.opts.store.getMerges()) { const { r1, c1, r2, c2 } = parseRange(m); for (let r = Math.max(r1, vis.startRow); r <= Math.min(r2, vis.endRow - 1); r += 1) for (let c = Math.max(c1, vis.startCol); c <= Math.min(c2, vis.endCol - 1); c += 1) if (r !== r1 || c !== c1) skip.add(`${r},${c}`); }
    return skip;
  }

  private paintTextWith(r: number, c: number, x: number, y: number, cw: number, rh: number, theme: CanvasTheme, style: import('../types').Style | undefined): void {
    const cell = this.opts.store.getCell(r, c); if (cell === undefined || cell.text.length === 0) return;
    const fontSize = Math.max(10, Math.round((style?.fontSize ?? 14) * this.zoom()));
    const fontFamily = style?.fontFamily ?? theme.fontFamily;
    const rawText = this.opts.showFormula === true && cell.formula !== undefined ? cell.formula : cell.text;
    const nf = style?.numberFormat;
    const fr = nf !== undefined && nf !== 'general' ? formatValue(cell.value, nf) : undefined;
    const text = fr?.formatted === true ? fr.text : rawText;
    const align = style?.align ?? 'left';
    this.ctx.save(); this.ctx.beginPath(); this.ctx.rect(x + 1, y + 1, cw - 2, rh - 2); this.ctx.clip();
    this.ctx.fillStyle = style?.color ?? theme.text; this.ctx.textBaseline = 'middle'; this.ctx.textAlign = align;
    this.ctx.font = `${style?.italic === true ? 'italic ' : ''}${style?.bold === true ? 'bold ' : ''}${fontSize}px ${fontFamily}`;
    const tx = align === 'center' ? x + cw / 2 : align === 'right' ? x + cw - 6 : x + 6;
    this.ctx.fillText(text, tx, y + rh / 2);
    if (style?.underline === true) { const w = typeof this.ctx.measureText === 'function' ? this.ctx.measureText(text).width : text.length * fontSize * 0.6; const sx = align === 'center' ? tx - w / 2 : align === 'right' ? tx - w : tx; this.ctx.beginPath(); this.ctx.moveTo(sx, y + rh / 2 + fontSize * 0.38); this.ctx.lineTo(sx + w, y + rh / 2 + fontSize * 0.38); this.ctx.strokeStyle = String(this.ctx.fillStyle); this.ctx.lineWidth = 1; this.ctx.stroke(); }
    this.ctx.restore();
  }

  private paintSelection(theme: CanvasTheme): void {
    if (this.selectedRange === undefined) return;
    const { x, y, w, h } = this.rangeRect(this.selectedRange);
    this.ctx.strokeStyle = theme.accent; this.ctx.lineWidth = 2; this.ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    if (this.activeCell !== undefined && new Range(this.selectedRange).contains(this.activeCell.r, this.activeCell.c) && this.selectionKind !== 'row' && this.selectionKind !== 'column' && this.selectionKind !== 'sheet') { const ac = this.cellVP(this.activeCell.r, this.activeCell.c); this.ctx.strokeRect(ac.x + 1, ac.y + 1, this.scroller.getColWidth(this.activeCell.c) - 2, this.scroller.getRowHeight(this.activeCell.r) - 2); }
    this.ctx.fillStyle = theme.accent; this.ctx.fillRect(x + w - 5, y + h - 5, 7, 7); this.ctx.lineWidth = 1;
  }

  private paintOverlays(theme: CanvasTheme): void {
    const indicator = this.resizeHandler.getIndicator();
    if (indicator !== null) { this.ctx.save(); this.ctx.setLineDash([4, 3]); this.ctx.strokeStyle = theme.accent; this.ctx.lineWidth = 1; this.ctx.beginPath(); if (indicator.type === 'row') { this.ctx.moveTo(0, indicator.position); this.ctx.lineTo(this.vpW(), indicator.position); } else { this.ctx.moveTo(indicator.position, 0); this.ctx.lineTo(indicator.position, this.vpH()); } this.ctx.stroke(); this.ctx.setLineDash([]); this.ctx.restore(); }
    const ft = this.fillHandle.getFillTarget();
    if (ft !== undefined) { const { x, y, w, h } = this.rangeRect(ft); this.ctx.save(); this.ctx.setLineDash([3, 3]); this.ctx.strokeStyle = theme.accent; this.ctx.lineWidth = 1.5; this.ctx.strokeRect(x, y, w, h); this.ctx.setLineDash([]); this.ctx.restore(); }
    this.paintHighlights(theme);
  }

  /** Paint find-match highlight cells with light yellow background. */
  private paintHighlights(_theme: CanvasTheme): void {
    if (this.highlightMatches.length === 0) return;
    this.ctx.save();
    for (const cell of this.highlightMatches) {
      const { x, y } = this.cellVP(cell.r, cell.c);
      this.ctx.fillStyle = 'rgba(255,255,0,0.3)';
      this.ctx.fillRect(x + 1, y + 1, this.scroller.getColWidth(cell.c) - 2, this.scroller.getRowHeight(cell.r) - 2);
    }
    this.ctx.restore();
  }

  /** Paint frozen rows/cols on top of the scrollable area — they don't scroll. */
  private paintFrozenPanes(vis: VisibleRange, theme: CanvasTheme): void {
    const fr = this.freeze.getFrozenRows();
    const fc = this.freeze.getFrozenCols();
    if (fr === 0 && fc === 0) return;

    // Paint frozen cells (scroll offset = 0)
    for (let r = 0; r < Math.min(fr, vis.endRow); r += 1) {
      for (let c = 0; c < Math.min(fc, vis.endCol); c += 1) {
        const { x, y } = this.frozenCellVP(r, c);
        this.paintCellBg(r, c, x, y, this.scroller.getColWidth(c), this.scroller.getRowHeight(r), theme);
      }
    }

    // Paint frozen row strip (full width, no vertical scroll)
    if (fr > 0) {
      for (let r = 0; r < Math.min(fr, vis.endRow); r += 1) {
        for (let c = vis.startCol; c < vis.endCol; c += 1) {
          const { x, y } = this.frozenCellVP(r, c);
          this.paintCellBg(r, c, x, y, this.scroller.getColWidth(c), this.scroller.getRowHeight(r), theme);
        }
      }
    }

    // Paint frozen col strip (full height, no horizontal scroll)
    if (fc > 0) {
      for (let r = vis.startRow; r < vis.endRow; r += 1) {
        for (let c = 0; c < Math.min(fc, vis.endCol); c += 1) {
          const { x, y } = this.frozenCellVP(r, c);
          this.paintCellBg(r, c, x, y, this.scroller.getColWidth(c), this.scroller.getRowHeight(r), theme);
        }
      }
    }

    // Draw freeze separator lines
    this.ctx.save();
    this.ctx.strokeStyle = theme.accent;
    this.ctx.lineWidth = 2;
    if (fc > 0) {
      const x = this.frozenColEdge(fc);
      this.ctx.beginPath(); this.ctx.moveTo(x, COL_HEADER_HEIGHT); this.ctx.lineTo(x, this.vpH()); this.ctx.stroke();
    }
    if (fr > 0) {
      const y = this.frozenRowEdge(fr);
      this.ctx.beginPath(); this.ctx.moveTo(ROW_HEADER_WIDTH, y); this.ctx.lineTo(this.vpW(), y); this.ctx.stroke();
    }
    this.ctx.restore();
  }

  /** Viewport position for a cell in the frozen zone (no scroll offset). */
  private frozenCellVP(r: number, c: number): { x: number; y: number } {
    const p = this.scroller.cellToPixel(r, c);
    return { x: ROW_HEADER_WIDTH + p.x, y: COL_HEADER_HEIGHT + p.y };
  }

  private frozenColEdge(col: number): number {
    let x = ROW_HEADER_WIDTH;
    for (let c = 0; c < col; c += 1) x += this.scroller.getColWidth(c);
    return x;
  }

  private frozenRowEdge(row: number): number {
    let y = COL_HEADER_HEIGHT;
    for (let r = 0; r < row; r += 1) y += this.scroller.getRowHeight(r);
    return y;
  }

  private rangeRect(range: RangeAddress): { x: number; y: number; w: number; h: number } {
    const { x, y } = this.cellVP(range.r1, range.c1);
    let w = 0; for (let c = range.c1; c <= range.c2; c += 1) w += this.scroller.getColWidth(c);
    let h = 0; for (let r = range.r1; r <= range.r2; r += 1) h += this.scroller.getRowHeight(r);
    return { x, y, w, h };
  }

  private isHighCol(c: number): boolean { return this.selectedRange !== undefined && this.selectionKind !== 'row' && c >= this.selectedRange.c1 && c <= this.selectedRange.c2; }
  private isHighRow(r: number): boolean { return this.selectedRange !== undefined && this.selectionKind !== 'column' && r >= this.selectedRange.r1 && r <= this.selectedRange.r2; }
  private isSelFill(r: number, c: number): boolean { const sr = this.selectedRange; if (sr === undefined || r < sr.r1 || r > sr.r2 || c < sr.c1 || c > sr.c2) return false; return !(this.activeCell?.r === r && this.activeCell.c === c && this.selectionKind !== 'row' && this.selectionKind !== 'column' && this.selectionKind !== 'sheet'); }
  private pointerCell(cx: number, cy: number): CellAddress | null { return canvasPointToCell(this.opts.canvas, cx, cy, this.scroller.scrollLeft, this.scroller.scrollTop, this.opts.zoom); }
  private cellVP(r: number, c: number): { x: number; y: number } { const p = this.scroller.cellToPixel(r, c); return { x: ROW_HEADER_WIDTH + p.x - this.scroller.scrollLeft, y: COL_HEADER_HEIGHT + p.y - this.scroller.scrollTop }; }
  private cellStyle(r: number, c: number) { const cell = this.opts.store.getCell(r, c); return cell?.styleId === undefined ? undefined : this.opts.store.getStyle(cell.styleId); }
  private zoom(): number { return (this.opts.zoom ?? 100) / 100; }
  private defaultRowHeight(): number { return ROW_HEIGHT * this.zoom(); }
  private defaultColWidth(): number { return COL_WIDTH * this.zoom(); }
  private gridW(): number { return Math.max(0, (this.opts.canvas.clientWidth || this.opts.canvas.width || 300) - ROW_HEADER_WIDTH); }
  private gridH(): number { return Math.max(0, (this.opts.canvas.clientHeight || this.opts.canvas.height || 150) - COL_HEADER_HEIGHT); }
  private vpW(): number { return this.opts.canvas.clientWidth || this.opts.canvas.width || 300; }
  private vpH(): number { return this.opts.canvas.clientHeight || this.opts.canvas.height || 150; }

  private syncSizesFromStore(): void {
    const z = this.zoom();
    for (let r = 0; r < TOTAL_ROWS; r += 1) { const h = this.opts.store.getRow(r)?.height; if (h !== undefined) this.scroller.setRowHeight(r, h * z); }
    for (let c = 0; c < TOTAL_COLS; c += 1) { const w = this.opts.store.getCol(c)?.width; if (w !== undefined) this.scroller.setColWidth(c, w * z); }
  }

  private onStoreEvent(e: StoreEvent): void {
    const z = this.zoom();
    if (e.type === 'row') { const h = e.meta?.height; this.scroller.setRowHeight(e.r, h !== undefined ? h * z : this.defaultRowHeight()); }
    if (e.type === 'col') { const w = e.meta?.width; this.scroller.setColWidth(e.c, w !== undefined ? w * z : this.defaultColWidth()); }
    this.invalidateAll();
  }
}
