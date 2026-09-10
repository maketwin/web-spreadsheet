import { num2alpha } from '../util/alphabet';
import type { SelectionKind } from '../selection/Selection';
import { Range, type RangeAddress } from '../selection/Range';
import type { Store } from '../store/Store';
import { TOTAL_ROWS, TOTAL_COLS, ROW_HEIGHT, COL_WIDTH, ROW_HEADER_WIDTH, COL_HEADER_HEIGHT, type CellAddress, type HeaderHit, canvasPointToCell, canvasPointToHeader, canvasPointToColumn, canvasPointToRow, clamp, type CanvasTheme, readCanvasTheme, headerSelectionColor } from './coordinate';
import { collectCellBorderEdges, edgesToPaintSegs, hasBorderOnEdge, strokeBorderSegs, type LogicalBorderEdge } from './BorderPainter';
import { DirtyRegionTracker, type Rect } from './DirtyRegionTracker';
import { FillHandle } from '../fill/FillHandle';
import { FreezeManager } from '../freeze/FreezeManager';
import { ResizeHandler } from './ResizeHandler';
import { VirtualScroller, type VisibleRange } from './VirtualScroller';
import type { StoreEvent, Style } from '../types';
import { parseRange } from '../util/cell';
import { formatValue } from '../format/NumberFormatter';
import { ConditionalService } from '../conditional/ConditionalService';
import { WRAP_LINE_HEIGHT, wrapTextLinesCanvas } from '../util/wrapText';

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
  onCellContextMenu?: (cell: CellAddress, x: number, y: number) => void;
  onMoveRange?: (source: RangeAddress, target: RangeAddress) => void;
}

type DragAnchor = { type: 'cell'; r: number; c: number } | { type: 'column'; c: number } | { type: 'row'; r: number };

interface MoveDragState {
  readonly source: RangeAddress;
  readonly offset: CellAddress;
  readonly target: CellAddress;
  readonly moved: boolean;
}

const SELECTION_BORDER_HIT_PX = 4;

/** Logical border edges for the current paint pass (deduped in edge-space). */

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
  private moveDrag: MoveDragState | null = null;
  private rafId: number | null = null;
  private highlightMatches: readonly CellAddress[] = [];
  private editing = false;
  private cachedTheme: CanvasTheme | null = null;
  private canvasCssW = 0;
  private canvasCssH = 0;
  private canvasDpr = 0;
  private readonly borderEdges = new Map<string, LogicalBorderEdge>();

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
  public setSelection(range: RangeAddress | undefined, kind: SelectionKind | undefined, activeCell?: CellAddress): void {
    const prev = this.selectedRange;
    this.selectedRange = range; this.selectionKind = kind; this.activeCell = activeCell;
    this.invalidateSelectionChrome(prev, range);
  }
  public setSelectedCell(cell: CellAddress | undefined): void { this.setSelection(cell === undefined ? undefined : Range.single(cell.r, cell.c).toAddress(), cell === undefined ? undefined : 'cell', cell); }
  /** Excel behavior: while editing, only the edited cell keeps a border — fills and the fill handle disappear. */
  public setEditing(editing: boolean): void {
    if (this.editing === editing) return;
    this.editing = editing;
    this.invalidateSelectionChrome(this.selectedRange, this.selectedRange);
  }

  /** Selection/edit chrome only — avoid full-sheet repaint on every arrow key. */
  private invalidateSelectionChrome(prev: RangeAddress | undefined, next: RangeAddress | undefined): void {
    const pad = 8; // covers 2px stroke + fill handle
    const mark = (range: RangeAddress | undefined): void => {
      if (range === undefined) { this.dirty.invalidateAll(); return; }
      const { x, y, w, h } = this.rangeRect(range);
      this.dirty.invalidate({ x: x - pad, y: y - pad, w: w + pad * 2, h: h + pad * 2 });
      this.dirty.invalidate({ x: 0, y: Math.max(0, y - pad), w: ROW_HEADER_WIDTH + 2, h: h + pad * 2 });
      this.dirty.invalidate({ x: Math.max(0, x - pad), y: 0, w: w + pad * 2, h: COL_HEADER_HEIGHT + 2 });
    };
    mark(prev);
    mark(next);
    this.scheduleRender();
  }

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
    // Excel: only primary button starts selection / drag. Right-click selection is handled in contextmenu
    // so a multi-cell selection is not collapsed before the menu opens.
    if (ev.button !== 0) return;
    if (this.resizeHandler.onMouseDown(ev)) return;
    if (this.fillHandle.onMouseDown(ev)) { this.dragAnchor = null; return; }
    const h = this.headerAtPoint(ev.clientX, ev.clientY);
    if (h?.type === 'sheet') { this.opts.canvas.focus(); this.dragAnchor = null; this.opts.onSheetSelect?.(); return; }
    if (h?.type === 'column') { this.opts.canvas.focus(); this.dragAnchor = { type: 'column', c: h.c }; this.opts.onColumnSelect?.(h.c, ev.shiftKey); return; }
    if (h?.type === 'row') { this.opts.canvas.focus(); this.dragAnchor = { type: 'row', r: h.r }; this.opts.onRowSelect?.(h.r, ev.shiftKey); return; }
    const cell = this.pointerCell(ev.clientX, ev.clientY); if (cell === null) return;
    this.opts.canvas.focus();
    if (this.selectedRange !== undefined && this.isSelectionBorderHit(ev.clientX, ev.clientY) && this.moveDrag === null) {
      this.moveDrag = {
        source: this.selectedRange,
        offset: { r: cell.r - this.selectedRange.r1, c: cell.c - this.selectedRange.c1 },
        target: { r: this.selectedRange.r1, c: this.selectedRange.c1 },
        moved: false,
      };
      this.opts.canvas.style.cursor = 'move';
      return;
    }
    this.dragAnchor = { type: 'cell', ...cell }; this.setSelectedCell(cell);
    if (ev.shiftKey) this.opts.onCellClick?.(cell, true); else this.opts.onCellClick?.(cell);
  };
  private readonly handleMouseMove = (ev: MouseEvent): void => {
    if (this.resizeHandler.isResizing()) { this.resizeHandler.onMouseMove(ev); return; }
    if (this.fillHandle.isDragging()) { this.fillHandle.onMouseMove(ev); return; }
    this.resizeHandler.onMouseMove(ev); this.fillHandle.onMouseMove(ev);
    if (this.moveDrag !== null) {
      const cell = this.pointerCell(ev.clientX, ev.clientY);
      if (cell !== null) {
        const target = this.moveTargetFromPointer(this.moveDrag, cell);
        this.moveDrag = {
          ...this.moveDrag,
          target,
          moved: this.moveDrag.moved || target.r !== this.moveDrag.source.r1 || target.c !== this.moveDrag.source.c1,
        };
        this.invalidateAll();
      }
      return;
    }
    if (this.dragAnchor === null) {
      if (this.opts.canvas.style.cursor === '' || this.opts.canvas.style.cursor === 'move') this.opts.canvas.style.cursor = this.isSelectionBorderHit(ev.clientX, ev.clientY) ? 'move' : '';
      return;
    }
    if (this.dragAnchor.type === 'column') { const c = this.columnAtPoint(ev.clientX); if (c !== null) this.opts.onColumnSelect?.(c, true); return; }
    if (this.dragAnchor.type === 'row') { const r = this.rowAtPoint(ev.clientY); if (r !== null) this.opts.onRowSelect?.(r, true); return; }
    const cell = this.pointerCell(ev.clientX, ev.clientY); if (cell === null) return;
    const range = new Range({ r1: this.dragAnchor.r, c1: this.dragAnchor.c, r2: cell.r, c2: cell.c }).toAddress();
    this.setSelection(range, 'range', cell); this.opts.onSelectionChange?.(range, cell, { r: this.dragAnchor.r, c: this.dragAnchor.c });
  };
  private readonly handleMouseUp = (): void => { if (this.resizeHandler.isResizing()) { this.resizeHandler.onMouseUp(); return; } if (this.fillHandle.isDragging()) { this.fillHandle.onMouseUp(); return; } if (this.moveDrag !== null) { if (this.moveDrag.moved) this.opts.onMoveRange?.(this.moveDrag.source, Range.single(this.moveDrag.target.r, this.moveDrag.target.c).toAddress()); this.moveDrag = null; this.opts.canvas.style.cursor = ''; this.invalidateAll(); return; } this.dragAnchor = null; };
  private readonly handleDblClick = (ev: MouseEvent): void => { if (this.resizeHandler.onDblClick(ev)) ev.stopPropagation(); };
  private readonly handleThemeChanged = (): void => { this.cachedTheme = null; this.invalidateAll(); };
  private readonly handleContextMenu = (ev: MouseEvent): void => {
    ev.preventDefault();
    const h = this.headerAtPoint(ev.clientX, ev.clientY);
    if (h?.type === 'row') { this.opts.onHeaderContextMenu?.({ type: 'row', r: h.r }, ev.clientX, ev.clientY); return; }
    if (h?.type === 'column') { this.opts.onHeaderContextMenu?.({ type: 'column', c: h.c }, ev.clientX, ev.clientY); return; }
    const cell = this.pointerCell(ev.clientX, ev.clientY);
    if (cell !== null) this.opts.onCellContextMenu?.(cell, ev.clientX, ev.clientY);
  };

  private scheduleRender(): void { if (this.rafId !== null) return; this.rafId = window.requestAnimationFrame(() => { this.rafId = null; this.render(); }); }
  private render(): void {
    if (this.dirty.isEmpty()) return;
    const resized = this.syncViewport();
    if (resized) this.dirty.invalidateAll();
    const theme = this.cachedTheme ?? (this.cachedTheme = readCanvasTheme());
    const vis = this.scroller.getVisibleRange();
    this.dirty.drain().forEach((r) => this.paintRegion(r, vis, theme));
  }
  /** @returns true when the canvas bitmap was recreated (content cleared). */
  private syncViewport(): boolean {
    const resized = this.setupCanvas();
    this.scroller.setViewport(this.gridW(), this.gridH());
    return resized;
  }
  /** Setting canvas.width/height clears the bitmap — only do it when size/dpr actually change. */
  private setupCanvas(): boolean {
    const dpr = this.opts.devicePixelRatio ?? window.devicePixelRatio ?? 1;
    const w = this.vpW();
    const h = this.vpH();
    if (w === this.canvasCssW && h === this.canvasCssH && dpr === this.canvasDpr) return false;
    this.canvasCssW = w;
    this.canvasCssH = h;
    this.canvasDpr = dpr;
    this.opts.canvas.width = Math.floor(w * dpr);
    this.opts.canvas.height = Math.floor(h * dpr);
    if (typeof this.ctx.setTransform === 'function') this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    else this.ctx.scale(dpr, dpr);
    return true;
  }

  private paintRegion(region: Rect, vis: VisibleRange, theme: CanvasTheme): void {
    this.ctx.save(); this.ctx.beginPath(); this.ctx.rect(region.x, region.y, region.w, region.h); this.ctx.clip();
    this.ctx.fillStyle = theme.bg; this.ctx.fillRect(0, 0, this.vpW(), this.vpH());
    this.paintHeaders(vis, theme);
    this.borderEdges.clear();
    // Excel overflow: paint fills first, then grid/borders, then text on top so long text spans empty cells
    this.paintCellBackgrounds(vis, theme);
    this.collectVisibleBorders(vis);
    this.paintGridLines(vis, theme);
    this.flushBorders();
    this.paintCellTexts(vis, theme);
    this.paintSelection(theme); this.paintOverlays(theme);
    if (this.freeze.isFrozen()) { this.paintFrozenPanes(vis, theme); this.borderEdges.clear(); this.collectVisibleBorders(vis); this.flushBorders(); }
    this.ctx.restore();
  }

  private paintHeaders(vis: VisibleRange, theme: CanvasTheme): void {
    this.ctx.fillStyle = theme.headerBg; this.ctx.fillRect(0, 0, this.vpW(), COL_HEADER_HEIGHT); this.ctx.fillRect(0, 0, ROW_HEADER_WIDTH, this.vpH());
    // Excel header chrome: light gray cells, hairline separators, dark-gray labels (no AutoFilter chevrons by default)
    this.ctx.textAlign = 'center'; this.ctx.textBaseline = 'middle';
    const headerFont = `${Math.max(11, Math.round(11 * this.zoom()))}px ${theme.fontFamily}`;
    this.ctx.font = headerFont;
    const headerText = cssHeaderText(theme);
    const colXs: number[] = [];
    let x = ROW_HEADER_WIDTH - this.scroller.scrollLeft; for (let i = 0; i < vis.startCol; i += 1) x += this.scroller.getColWidth(i);
    colXs.push(x);
    for (let c = vis.startCol; c < vis.endCol; c += 1) {
      const w = this.scroller.getColWidth(c);
      const level = this.colHeaderLevel(c);
      this.paintHeaderHighlight(level, x + 0.5, 0.5, w - 1, COL_HEADER_HEIGHT - 1, theme);
      this.ctx.fillStyle = level === 'solid' ? theme.bg : headerText;
      this.ctx.fillText(num2alpha(c), x + w / 2, COL_HEADER_HEIGHT / 2);
      x += w;
      colXs.push(x);
    }
    const rowYs: number[] = [];
    let y = COL_HEADER_HEIGHT - this.scroller.scrollTop; for (let i = 0; i < vis.startRow; i += 1) y += this.scroller.getRowHeight(i);
    rowYs.push(y);
    for (let r = vis.startRow; r < vis.endRow; r += 1) {
      const h = this.scroller.getRowHeight(r);
      const level = this.rowHeaderLevel(r);
      this.paintHeaderHighlight(level, 0.5, y + 0.5, ROW_HEADER_WIDTH - 1, h - 1, theme);
      this.ctx.fillStyle = level === 'solid' ? theme.bg : headerText;
      this.ctx.fillText(String(r + 1), ROW_HEADER_WIDTH / 2, y + h / 2);
      y += h;
      rowYs.push(y);
    }
    if (this.selectionKind === 'sheet') { this.ctx.fillStyle = headerSelectionColor(theme); this.ctx.fillRect(1, 1, ROW_HEADER_WIDTH - 2, COL_HEADER_HEIGHT - 2); }
    // Hairline header separators (once per edge)
    this.ctx.strokeStyle = theme.border;
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    const bottomH = COL_HEADER_HEIGHT;
    const rightH = ROW_HEADER_WIDTH;
    this.ctx.moveTo(0.5, bottomH - 0.5); this.ctx.lineTo(this.vpW(), bottomH - 0.5);
    this.ctx.moveTo(rightH - 0.5, 0.5); this.ctx.lineTo(rightH - 0.5, this.vpH());
    for (const vx of colXs) {
      const lx = Math.round(vx) + 0.5;
      this.ctx.moveTo(lx, 0.5); this.ctx.lineTo(lx, bottomH - 0.5);
    }
    for (const hy of rowYs) {
      const ly = Math.round(hy) + 0.5;
      this.ctx.moveTo(0.5, ly); this.ctx.lineTo(rightH - 0.5, ly);
    }
    this.ctx.stroke();
  }

  private paintCellBackgrounds(vis: VisibleRange, theme: CanvasTheme): void {
    const skip = this.mergeSkipSet(vis);
    for (let r = vis.startRow; r < vis.endRow; r += 1) {
      const rowMeta = this.opts.store.getRow(r);
      if (rowMeta?.hide === true) continue;
      for (let c = vis.startCol; c < vis.endCol; c += 1) {
        if (skip.has(`${r},${c}`)) continue;
        const merge = this.opts.store.getMergeAt(r, c);
        if (merge !== undefined) {
          const mr = parseRange(merge);
          const rect = this.rangeRect(mr);
          this.paintCellFillOnly(mr.r1, mr.c1, rect.x, rect.y, rect.w, rect.h, theme);
          continue;
        }
        const { x, y } = this.cellVP(r, c);
        this.paintCellFillOnly(r, c, x, y, this.scroller.getColWidth(c), this.scroller.getRowHeight(r), theme);
      }
    }
  }

  private paintCellTexts(vis: VisibleRange, theme: CanvasTheme): void {
    const skip = this.mergeSkipSet(vis);
    for (let r = vis.startRow; r < vis.endRow; r += 1) {
      const rowMeta = this.opts.store.getRow(r);
      if (rowMeta?.hide === true) continue;
      for (let c = vis.startCol; c < vis.endCol; c += 1) {
        if (skip.has(`${r},${c}`)) continue;
        const merge = this.opts.store.getMergeAt(r, c);
        if (merge !== undefined) {
          const mr = parseRange(merge);
          // Only paint text from the merge anchor
          if (r !== mr.r1 || c !== mr.c1) continue;
          const rect = this.rangeRect(mr);
          const style = this.mergedPaintStyle(mr.r1, mr.c1);
          this.paintTextWith(mr.r1, mr.c1, rect.x, rect.y, rect.w, rect.h, theme, style);
          continue;
        }
        const { x, y } = this.cellVP(r, c);
        const style = this.mergedPaintStyle(r, c);
        this.paintTextWith(r, c, x, y, this.scroller.getColWidth(c), this.scroller.getRowHeight(r), theme, style);
      }
    }
  }

  private mergedPaintStyle(r: number, c: number): Style | undefined {
    const style = this.cellStyle(r, c);
    const overlay = this.conditionalService.computeOverlay(this.opts.store, r, c);
    return { ...style, ...overlay.style };
  }


  /** Excel hairline grid: one stroke per shared edge; skip where a style border already owns the edge. */
  private paintGridLines(vis: VisibleRange, theme: CanvasTheme): void {
    if (this.opts.showGrid === false) return;
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.rect(ROW_HEADER_WIDTH, COL_HEADER_HEIGHT, this.gridW(), this.gridH());
    this.ctx.clip();
    this.ctx.strokeStyle = theme.grid;
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();

    const colCount = vis.endCol - vis.startCol;
    const rowCount = vis.endRow - vis.startRow;
    const xs: number[] = new Array(colCount + 1);
    const ys: number[] = new Array(rowCount + 1);
    for (let i = 0; i <= colCount; i += 1) {
      const c = vis.startCol + i;
      xs[i] = Math.round(c >= TOTAL_COLS
        ? this.cellVP(0, TOTAL_COLS - 1).x + this.scroller.getColWidth(TOTAL_COLS - 1)
        : this.cellVP(0, c).x) + 0.5;
    }
    for (let i = 0; i <= rowCount; i += 1) {
      const r = vis.startRow + i;
      ys[i] = Math.round(r >= TOTAL_ROWS
        ? this.cellVP(TOTAL_ROWS - 1, 0).y + this.scroller.getRowHeight(TOTAL_ROWS - 1)
        : this.cellVP(r, 0).y) + 0.5;
    }

    for (let i = 0; i <= colCount; i += 1) {
      const c = vis.startCol + i;
      const lx = xs[i]!;
      for (let j = 0; j < rowCount; j += 1) {
        const r = vis.startRow + j;
        if (hasBorderOnEdge(this.borderEdges, 'v', c, r)) continue;
        this.ctx.moveTo(lx, ys[j]!);
        this.ctx.lineTo(lx, ys[j + 1]!);
      }
    }
    for (let j = 0; j <= rowCount; j += 1) {
      const r = vis.startRow + j;
      const ly = ys[j]!;
      for (let i = 0; i < colCount; i += 1) {
        const c = vis.startCol + i;
        if (hasBorderOnEdge(this.borderEdges, 'h', r, c)) continue;
        this.ctx.moveTo(xs[i]!, ly);
        this.ctx.lineTo(xs[i + 1]!, ly);
      }
    }
    this.ctx.stroke();
    this.ctx.restore();
  }



  private paintCellFillOnly(r: number, c: number, x: number, y: number, cw: number, rh: number, _theme: CanvasTheme): void {
    const style = this.cellStyle(r, c);
    const overlay = this.conditionalService.computeOverlay(this.opts.store, r, c);
    const merged = { ...style, ...overlay.style };
    if (merged.bgcolor !== undefined) { this.ctx.fillStyle = merged.bgcolor; this.ctx.fillRect(x + 1, y + 1, cw - 2, rh - 2); }
    if (overlay.dataBar !== undefined) { this.paintDataBar(x, y, cw, rh, overlay.dataBar.ratio, overlay.dataBar.color); }
  }

  /** @deprecated kept for frozen-pane helpers that still paint fill+text together */
  private paintCellBg(r: number, c: number, x: number, y: number, cw: number, rh: number, theme: CanvasTheme): void {
    this.paintCellFillOnly(r, c, x, y, cw, rh, theme);
    this.paintTextWith(r, c, x, y, cw, rh, theme, this.mergedPaintStyle(r, c));
  }

  /**
   * Collect style borders for the visible window (+1 cell ring) into logical edge space.
   * The ring matters so a neighbor just off-screen can still own a shared edge we must draw.
   */
  private collectVisibleBorders(vis: VisibleRange): void {
    const r0 = Math.max(0, vis.startRow - 1);
    const r1 = Math.min(TOTAL_ROWS, vis.endRow + 1);
    const c0 = Math.max(0, vis.startCol - 1);
    const c1 = Math.min(TOTAL_COLS, vis.endCol + 1);
    for (let r = r0; r < r1; r += 1) {
      for (let c = c0; c < c1; c += 1) {
        const style = this.cellStyle(r, c);
        collectCellBorderEdges(this.borderEdges, r, c, style?.border);
      }
    }
  }

  /** Stroke resolved borders once per logical edge (Excel: no missing, no double). Also while editing. */
  private flushBorders(): void {
    const colLeft = (c: number): number => {
      if (c >= TOTAL_COLS) {
        const last = this.cellVP(0, TOTAL_COLS - 1);
        return last.x + this.scroller.getColWidth(TOTAL_COLS - 1);
      }
      return this.cellVP(0, Math.max(0, c)).x;
    };
    const rowTop = (r: number): number => {
      if (r >= TOTAL_ROWS) {
        const last = this.cellVP(TOTAL_ROWS - 1, 0);
        return last.y + this.scroller.getRowHeight(TOTAL_ROWS - 1);
      }
      return this.cellVP(Math.max(0, r), 0).y;
    };
    const segs = edgesToPaintSegs(this.borderEdges.values(), {
      originX: ROW_HEADER_WIDTH,
      originY: COL_HEADER_HEIGHT,
      colLeft,
      rowTop,
      colWidth: (c: number) => this.scroller.getColWidth(Math.max(0, Math.min(c, TOTAL_COLS - 1))),
      rowHeight: (r: number) => this.scroller.getRowHeight(Math.max(0, Math.min(r, TOTAL_ROWS - 1))),
    });
    strokeBorderSegs(this.ctx, segs, this.zoom(), { x: ROW_HEADER_WIDTH, y: COL_HEADER_HEIGHT, w: this.gridW(), h: this.gridH() });
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

  private paintTextWith(r: number, c: number, x: number, y: number, cw: number, rh: number, theme: CanvasTheme, style: Style | undefined): void {
    const cell = this.opts.store.getCell(r, c); if (cell === undefined || cell.text.length === 0) return;
    const fontSize = Math.max(8, Math.round((style?.fontSize ?? 11) * this.zoom()));
    const fontFamily = style?.fontFamily ?? theme.fontFamily;
    const rawText = this.opts.showFormula === true && cell.formula !== undefined ? cell.formula : cell.text;
    const nf = style?.numberFormat;
    const fr = nf !== undefined && nf !== 'general' ? formatValue(cell.value, nf) : undefined;
    const text = fr?.formatted === true ? fr.text : rawText;
    const align = style?.align ?? 'left';
    const wrapping = style?.wrap === true;

    this.ctx.save();
    // Vertical clip always to the row band; horizontal expands across empty neighbors when wrap is off (Excel overflow).
    const clipY = y + 1;
    const clipH = Math.max(0, rh - 2);
    let clipX = x + 1;
    let clipW = Math.max(0, cw - 2);
    if (!wrapping) {
      const span = this.textOverflowSpan(r, c, x, cw, align);
      clipX = span.left;
      clipW = Math.max(0, span.right - span.left);
    }
    this.ctx.beginPath();
    this.ctx.rect(clipX, clipY, clipW, clipH);
    this.ctx.clip();

    this.ctx.fillStyle = style?.color ?? theme.text; this.ctx.textBaseline = 'middle'; this.ctx.textAlign = align;
    this.ctx.font = `${style?.italic === true ? 'italic ' : ''}${style?.bold === true ? 'bold ' : ''}${fontSize}px ${fontFamily}`;
    const tx = align === 'center' ? x + cw / 2 : align === 'right' ? x + cw - 3 : x + 3;
    const maxW = Math.max(4, cw - 6);
    const lines = wrapping ? wrapTextLinesCanvas(this.ctx, text, maxW) : [text.replace(/\r?\n/g, '')];
    const lineH = fontSize * WRAP_LINE_HEIGHT;
    const startY = wrapping ? y + 2 + fontSize * 0.55 : y + rh / 2;
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]!;
      const ly = startY + i * lineH;
      if (ly > y + rh) break;
      this.ctx.fillText(line, tx, ly);
      if (style?.underline === true) {
        const w = typeof this.ctx.measureText === 'function' ? this.ctx.measureText(line).width : line.length * fontSize * 0.6;
        const sx = align === 'center' ? tx - w / 2 : align === 'right' ? tx - w : tx;
        this.ctx.beginPath();
        this.ctx.moveTo(sx, ly + fontSize * 0.38);
        this.ctx.lineTo(sx + w, ly + fontSize * 0.38);
        this.ctx.strokeStyle = String(this.ctx.fillStyle);
        this.ctx.lineWidth = 1;
        this.ctx.stroke();
      }
    }
    this.ctx.restore();
  }

  /** Excel: without wrap, text may spill into adjacent empty cells until a non-empty cell blocks it. */
  private textOverflowSpan(r: number, c: number, x: number, cw: number, align: 'left' | 'center' | 'right'): { left: number; right: number } {
    let left = x;
    let right = x + cw;
    if (align === 'left' || align === 'center') {
      for (let nc = c + 1; nc < TOTAL_COLS; nc += 1) {
        if (!this.cellAllowsTextOverflow(r, nc)) break;
        right += this.scroller.getColWidth(nc);
      }
    }
    if (align === 'right' || align === 'center') {
      for (let nc = c - 1; nc >= 0; nc -= 1) {
        if (!this.cellAllowsTextOverflow(r, nc)) break;
        left -= this.scroller.getColWidth(nc);
      }
    }
    // Keep overflow inside the grid area (not over row headers)
    const gridLeft = ROW_HEADER_WIDTH;
    const gridRight = ROW_HEADER_WIDTH + this.gridW();
    return { left: Math.max(gridLeft, left), right: Math.min(gridRight, right) };
  }

  /** Empty (no visible text) and unmerged cells can show a neighbor's overflowing text. */
  private cellAllowsTextOverflow(r: number, c: number): boolean {
    if (this.opts.store.getMergeAt(r, c) !== undefined) return false;
    const cell = this.opts.store.getCell(r, c);
    if (cell !== undefined && cell.text.length > 0) return false;
    const style = this.cellStyle(r, c);
    // A filled background blocks overflow the same way Excel does
    if (style?.bgcolor !== undefined && style.bgcolor.toLowerCase() !== '#ffffff') return false;
    return true;
  }

  /** Excel-style selection: translucent accent fill, 2px border, white active cell, corner fill handle. */
  private paintSelection(theme: CanvasTheme): void {
    const sr = this.selectedRange;
    if (sr === undefined) return;

    const kind = this.selectionKind ?? 'cell';
    const { x, y, w, h } = this.rangeRect(sr);

    // Never paint over the row/column headers — clip selection art to the grid area
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.rect(ROW_HEADER_WIDTH, COL_HEADER_HEIGHT, this.gridW(), this.gridH());
    this.ctx.clip();

    // While editing: CSS overlay is borderless input only. Canvas keeps the 2px accent
    // strokeRect (same geometry as normal selection) so it covers style borders the same
    // way — including bottom/right hairlines drawn at round(edge)+0.5 outside the CSS box.
    if (this.editing) {
      if (kind !== 'sheet') {
        this.ctx.strokeStyle = theme.accent;
        this.ctx.lineWidth = 2;
        this.ctx.strokeRect(x, y, w, h);
        this.ctx.lineWidth = 1;
      }
      this.ctx.restore();
      return;
    }

    this.ctx.fillStyle = selectionFillColor(theme);
    const ac = this.activeCell;
    const hole = ac !== undefined && new Range(sr).contains(ac.r, ac.c);
    if (!hole) {
      this.ctx.fillRect(x, y, w, h);
    } else {
      const ap = this.cellVP(ac.r, ac.c);
      const aw = this.scroller.getColWidth(ac.c);
      const ah = this.scroller.getRowHeight(ac.r);
      if (ap.y > y) this.ctx.fillRect(x, y, w, ap.y - y);
      if (ap.y + ah < y + h) this.ctx.fillRect(x, ap.y + ah, w, y + h - (ap.y + ah));
      if (ap.x > x) this.ctx.fillRect(x, ap.y, ap.x - x, ah);
      if (ap.x + aw < x + w) this.ctx.fillRect(ap.x + aw, ap.y, x + w - (ap.x + aw), ah);
    }

    if (kind === 'sheet') { this.ctx.restore(); return; }
    // Excel centers the 2px selection stroke on the range boundary, covering the cell border beneath it
    this.ctx.strokeStyle = theme.accent; this.ctx.lineWidth = 2;
    this.ctx.strokeRect(x, y, w, h);
    this.ctx.lineWidth = 1;
    // Excel fill handle: small accent square with a white border, centered on the corner
    this.ctx.fillStyle = theme.accent;
    this.ctx.fillRect(x + w - 3, y + h - 3, 6, 6);
    this.ctx.strokeStyle = theme.bg;
    this.ctx.strokeRect(x + w - 3.5, y + h - 3.5, 7, 7);
    this.ctx.restore();
  }

  /** Paint header highlight bg; returns the text color to use for this header. */
  private paintHeaderHighlight(level: 'none' | 'tint' | 'solid', hx: number, hy: number, hw: number, hh: number, theme: CanvasTheme): string {
    if (level === 'solid') { this.ctx.fillStyle = theme.accent; this.ctx.fillRect(hx, hy, hw, hh); return theme.bg; }
    if (level === 'tint') { this.ctx.fillStyle = headerSelectionColor(theme); this.ctx.fillRect(hx, hy, hw, hh); }
    return theme.text;
  }

  private colHeaderLevel(c: number): 'none' | 'tint' | 'solid' {
    const sr = this.selectedRange;
    if (sr === undefined) return 'none';
    if (this.selectionKind === 'sheet') return 'tint';
    if (this.selectionKind === 'column') return c >= sr.c1 && c <= sr.c2 ? 'solid' : 'none';
    if (this.selectionKind === 'row') return 'none';
    return c >= sr.c1 && c <= sr.c2 ? 'tint' : 'none';
  }

  private rowHeaderLevel(r: number): 'none' | 'tint' | 'solid' {
    const sr = this.selectedRange;
    if (sr === undefined) return 'none';
    if (this.selectionKind === 'sheet') return 'tint';
    if (this.selectionKind === 'row') return r >= sr.r1 && r <= sr.r2 ? 'solid' : 'none';
    if (this.selectionKind === 'column') return 'none';
    return r >= sr.r1 && r <= sr.r2 ? 'tint' : 'none';
  }

  private paintOverlays(theme: CanvasTheme): void {
    const indicator = this.resizeHandler.getIndicator();
    if (indicator !== null) { this.ctx.save(); this.ctx.setLineDash([4, 3]); this.ctx.strokeStyle = theme.accent; this.ctx.lineWidth = 1; this.ctx.beginPath(); if (indicator.type === 'row') { this.ctx.moveTo(0, indicator.position); this.ctx.lineTo(this.vpW(), indicator.position); } else { this.ctx.moveTo(indicator.position, 0); this.ctx.lineTo(indicator.position, this.vpH()); } this.ctx.stroke(); this.ctx.setLineDash([]); this.ctx.restore(); }
    const ft = this.fillHandle.getFillTarget();
    if (ft !== undefined) { const { x, y, w, h } = this.rangeRect(ft); this.ctx.save(); this.ctx.setLineDash([3, 3]); this.ctx.strokeStyle = theme.accent; this.ctx.lineWidth = 1.5; this.ctx.strokeRect(x, y, w, h); this.ctx.setLineDash([]); this.ctx.restore(); }
    this.paintMoveDragOverlay(theme);
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


  /** Check the rendered selection outline, not the whole edge cell, for Excel-style drag-to-move. */
  private isSelectionBorderHit(clientX: number, clientY: number): boolean {
    const sr = this.selectedRange;
    if (sr === undefined) return false;
    const rect = this.opts.canvas.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const { x, y, w, h } = this.rangeRect(sr);
    const left = x + 1;
    const top = y + 1;
    const right = x + w - 1;
    const bottom = y + h - 1;
    const withinX = px >= left - SELECTION_BORDER_HIT_PX && px <= right + SELECTION_BORDER_HIT_PX;
    const withinY = py >= top - SELECTION_BORDER_HIT_PX && py <= bottom + SELECTION_BORDER_HIT_PX;
    if (!withinX || !withinY) return false;
    return Math.abs(px - left) <= SELECTION_BORDER_HIT_PX || Math.abs(px - right) <= SELECTION_BORDER_HIT_PX || Math.abs(py - top) <= SELECTION_BORDER_HIT_PX || Math.abs(py - bottom) <= SELECTION_BORDER_HIT_PX;
  }

  private moveTargetFromPointer(drag: MoveDragState, pointer: CellAddress): CellAddress {
    const rows = drag.source.r2 - drag.source.r1 + 1;
    const cols = drag.source.c2 - drag.source.c1 + 1;
    return {
      r: clamp(pointer.r - drag.offset.r, 0, TOTAL_ROWS - rows),
      c: clamp(pointer.c - drag.offset.c, 0, TOTAL_COLS - cols),
    };
  }

  /** Paint the move-drag target outline. */
  private paintMoveDragOverlay(theme: CanvasTheme): void {
    if (this.moveDrag === null) return;
    const src = this.moveDrag.source;
    const tgt = this.moveDrag.target;
    const rows = src.r2 - src.r1 + 1;
    const cols = src.c2 - src.c1 + 1;
    const targetRange = { r1: tgt.r, c1: tgt.c, r2: tgt.r + rows - 1, c2: tgt.c + cols - 1 };
    const { x, y, w, h } = this.rangeRect(targetRange);
    this.ctx.save();
    this.ctx.setLineDash([6, 3]);
    this.ctx.strokeStyle = theme.accent;
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(x, y, w, h);
    this.ctx.setLineDash([]);
    this.ctx.restore();
  }
  private pointerCell(cx: number, cy: number): CellAddress | null {
    const rect = this.opts.canvas.getBoundingClientRect();
    const gx = cx - rect.left - ROW_HEADER_WIDTH + this.scroller.scrollLeft;
    const gy = cy - rect.top - COL_HEADER_HEIGHT + this.scroller.scrollTop;
    if (gx < 0 || gy < 0) return null;
    let r = 0;
    let y = 0;
    while (r < TOTAL_ROWS && y + this.scroller.getRowHeight(r) <= gy) { y += this.scroller.getRowHeight(r); r += 1; }
    let c = 0;
    let x = 0;
    while (c < TOTAL_COLS && x + this.scroller.getColWidth(c) <= gx) { x += this.scroller.getColWidth(c); c += 1; }
    if (r >= TOTAL_ROWS || c >= TOTAL_COLS) return null;
    return { r, c };
  }

  /** Public size-aware hit tests (scroller units are already zoomed). */
  public cellAtPoint(clientX: number, clientY: number): CellAddress | null { return this.pointerCell(clientX, clientY); }

  /** Viewport rect of a cell (includes scroll) — use this for the editor overlay so it matches canvas geometry. */
  public getCellViewportRect(r: number, c: number): { x: number; y: number; w: number; h: number } {
    const { x, y } = this.cellVP(r, c);
    return { x, y, w: this.scroller.getColWidth(c), h: this.scroller.getRowHeight(r) };
  }

  public columnAtPoint(clientX: number): number | null {
    const rect = this.opts.canvas.getBoundingClientRect();
    const gx = clientX - rect.left - ROW_HEADER_WIDTH + this.scroller.scrollLeft;
    if (gx < 0) return null;
    let c = 0;
    let x = 0;
    while (c < TOTAL_COLS && x + this.scroller.getColWidth(c) <= gx) { x += this.scroller.getColWidth(c); c += 1; }
    return c >= TOTAL_COLS ? TOTAL_COLS - 1 : c;
  }

  public rowAtPoint(clientY: number): number | null {
    const rect = this.opts.canvas.getBoundingClientRect();
    const gy = clientY - rect.top - COL_HEADER_HEIGHT + this.scroller.scrollTop;
    if (gy < 0) return null;
    let r = 0;
    let y = 0;
    while (r < TOTAL_ROWS && y + this.scroller.getRowHeight(r) <= gy) { y += this.scroller.getRowHeight(r); r += 1; }
    return r >= TOTAL_ROWS ? TOTAL_ROWS - 1 : r;
  }

  private headerAtPoint(clientX: number, clientY: number): HeaderHit {
    const rect = this.opts.canvas.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    const inRowHeader = mx >= 0 && mx < ROW_HEADER_WIDTH;
    const inColHeader = my >= 0 && my < COL_HEADER_HEIGHT;
    if (inRowHeader && inColHeader) return { type: 'sheet' };
    if (inColHeader) { const c = this.columnAtPoint(clientX); return c === null ? null : { type: 'column', c }; }
    if (inRowHeader) { const r = this.rowAtPoint(clientY); return r === null ? null : { type: 'row', r }; }
    return null;
  }
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

/** Excel column/row header label color (dark gray, not pure black). */
function cssHeaderText(_theme: CanvasTheme): string {
  if (typeof document === 'undefined') return '#444444';
  const v = getComputedStyle(document.documentElement).getPropertyValue('--ss-header-text').trim();
  return v || '#444444';
}

/** Translucent accent fill for selected cells (Excel tints the selection instead of a solid color). */
export function selectionFillColor(theme: CanvasTheme): string {
  return typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('color', 'color-mix(in srgb, #000 10%, transparent)') ? `color-mix(in srgb, ${theme.accent} 18%, transparent)` : theme.selected;
}

