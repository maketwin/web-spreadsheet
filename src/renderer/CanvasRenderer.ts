import { num2alpha } from '../util/alphabet';
import type { SelectionKind } from '../selection/Selection';
import { Range, type RangeAddress } from '../selection/Range';
import type { Store } from '../store/Store';
import { TOTAL_ROWS, TOTAL_COLS, ROW_HEIGHT, COL_WIDTH, ROW_HEADER_WIDTH, COL_HEADER_HEIGHT, type CellAddress, type HeaderHit, canvasPointToCell, canvasPointToHeader, canvasPointToColumn, canvasPointToRow, clamp, type CanvasTheme, readCanvasTheme, headerSelectionColor } from './coordinate';
import { collectCellBorderEdges, edgesToPaintSegs, hasBorderOnEdge, strokeBorderSegs, type LogicalBorderEdge } from './BorderPainter';
import { DirtyRegionTracker, type Rect } from './DirtyRegionTracker';
import { FillHandle } from '../fill/FillHandle';
import { doubleClickFillTarget } from '../fill/dblclickFill';
import { FreezeManager } from '../freeze/FreezeManager';
import { ResizeHandler } from './ResizeHandler';
import { VirtualScroller, type VisibleRange } from './VirtualScroller';
import type { StoreEvent, Style } from '../types';
import { parseRange } from '../util/cell';
import { formatValue } from '../format/NumberFormatter';
import { ConditionalService } from '../conditional/ConditionalService';
import { WRAP_LINE_HEIGHT, wrapTextLines } from '../util/wrapText';
import { TextMetricsCache } from './cache/TextMetricsCache';

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
  onMoveRange?: (source: RangeAddress, target: RangeAddress, copy?: boolean) => void;
  onAutoFilterClick?: (r: number, c: number, x: number, y: number) => void;
}

type DragAnchor = { type: 'cell'; r: number; c: number } | { type: 'column'; c: number } | { type: 'row'; r: number };

/** A paint tile: cell range plus the viewport rect it is clipped to (freeze quadrants). */
interface PaintQuad {
  r0: number;
  r1: number;
  c0: number;
  c1: number;
  clip: Rect;
}

interface MoveDragState {
  readonly source: RangeAddress;
  readonly offset: CellAddress;
  readonly target: CellAddress;
  readonly moved: boolean;
  /** Excel: holding Ctrl during the drag duplicates instead of moving. */
  readonly copy: boolean;
}

const SELECTION_BORDER_HIT_PX = 4;
const AUTO_FILTER_BUTTON_WIDTH = 16;
/** Excel colors the row numbers surviving a filter in blue (not the theme accent). */
const FILTERED_ROW_NUMBER_COLOR = '#0057C2';

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
  private readonly textMetrics = new TextMetricsCache();
  /** Overlay layer: selection chrome, fill-drag target, move-drag outline, highlights.
   * Painted on a stacked canvas so interaction never triggers a grid repaint. */
  private overlayCanvas: HTMLCanvasElement | null = null;
  private octx: CanvasRenderingContext2D | null = null;
  /** Scroll blit cache: snapshot of the last fully-painted grid frame. On pure
   * scrolls we shift the snapshot and repaint only the newly exposed bands. */
  private blitCanvas: HTMLCanvasElement | null = null;
  private blitValid = false;
  private blitLeft = 0;
  private blitTop = 0;
  /** Excel marching ants: copied/cut source range, animated dashed border on the overlay. */
  private clipboardRange: RangeAddress | undefined;
  private antsOffset = 0;
  private antsTimer: number | null = null;

  public constructor(private readonly opts: CanvasRendererOptions) {
    const ctx = opts.canvas.getContext('2d');
    if (ctx === null) throw new Error('Canvas 2D context not available');
    this.ctx = ctx;
    this.selectedRange = opts.selectedRange; this.selectionKind = opts.selectionKind; this.activeCell = opts.activeCell;
    this.scroller = new VirtualScroller({ totalRows: TOTAL_ROWS, totalCols: TOTAL_COLS, defaultRowHeight: this.defaultRowHeight(), defaultColWidth: this.defaultColWidth(), viewportW: this.gridW(), viewportH: this.gridH() });
    this.freeze = new FreezeManager({ totalRows: TOTAL_ROWS, totalCols: TOTAL_COLS });
    if ((opts.frozenRows ?? 0) > 0 || (opts.frozenCols ?? 0) > 0) this.freeze.freezeAt(opts.frozenRows ?? 0, opts.frozenCols ?? 0);
    this.syncSizesFromStore();
    this.resizeHandler = new ResizeHandler({ canvas: opts.canvas, scroller: this.scroller, store: opts.store, zoom: () => this.zoom(), onRowResize: opts.onRowResize, onColResize: opts.onColResize, onRowDblClick: opts.onRowDblClick, onColDblClick: opts.onColDblClick, invalidate: () => this.invalidateAll(), rowTopAt: (r) => this.cellVP(r, 0).y, colLeftAt: (c) => this.cellVP(0, c).x, frozenRows: () => this.freeze.getFrozenRows(), frozenCols: () => this.freeze.getFrozenCols() });
    // While ants replace the selection border the fill handle is hidden (Excel):
    // report no selection so its hit-test and crosshair cursor stay inactive.
    this.fillHandle = new FillHandle({ canvas: opts.canvas, scroller: this.scroller, selectedRange: () => this.antsReplaceSelection(this.selectedRange) ? undefined : this.selectedRange, onFill: opts.onFill, invalidate: () => this.invalidateAll(), cellVP: (r, c) => this.cellVP(r, c), cellAtPoint: (x, y) => this.pointerCell(x, y) });
    this.unsubscribe = opts.store.subscribe((e: StoreEvent) => this.onStoreEvent(e));
    this.setupCanvas(); this.setupOverlay(); this.bindEvents(); this.invalidateAll();
  }

  /** Create the stacked overlay canvas (no pointer events) above the grid canvas. */
  private setupOverlay(): void {
    if (typeof document === 'undefined') return;
    const parent = this.opts.canvas.parentElement;
    if (parent === null) return;
    const overlay = document.createElement('canvas');
    overlay.className = 'ss-overlay-canvas';
    overlay.style.position = 'absolute';
    overlay.style.left = '0';
    overlay.style.top = '0';
    overlay.style.pointerEvents = 'none';
    overlay.setAttribute('aria-hidden', 'true');
    if (typeof getComputedStyle === 'function' && getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
    parent.appendChild(overlay);
    this.overlayCanvas = overlay;
    this.octx = overlay.getContext('2d', { alpha: true });
    overlay.style.background = 'transparent';
    // Overlay was created after the initial setupCanvas call — size it now.
    this.syncOverlaySize(this.vpW(), this.vpH(), this.opts.devicePixelRatio ?? window.devicePixelRatio ?? 1);
  }

  private syncOverlaySize(w: number, h: number, dpr: number): void {
    if (this.overlayCanvas === null || this.octx === null) return;
    this.overlayCanvas.width = Math.floor(w * dpr);
    this.overlayCanvas.height = Math.floor(h * dpr);
    this.overlayCanvas.style.width = `${w}px`;
    this.overlayCanvas.style.height = `${h}px`;
    if (typeof this.octx.setTransform === 'function') this.octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    else this.octx.scale(dpr, dpr);
  }

  /** (Re)create the scroll-blit snapshot canvas to match the grid canvas size. */
  private setupBlit(): void {
    if (typeof document === 'undefined') return;
    if (this.blitCanvas === null) this.blitCanvas = document.createElement('canvas');
    const dpr = this.canvasDpr || 1;
    const w = Math.floor(this.vpW() * dpr);
    const h = Math.floor(this.vpH() * dpr);
    if (this.blitCanvas.width !== w || this.blitCanvas.height !== h) {
      this.blitCanvas.width = w;
      this.blitCanvas.height = h;
      this.blitValid = false;
    }
  }

  public destroy(): void {
    if (this.rafId !== null) window.cancelAnimationFrame(this.rafId);
    this.rafId = null; this.resizeHandler.destroy(); this.fillHandle.destroy(); this.unsubscribe(); this.unbindEvents();
    this.overlayCanvas?.remove(); this.overlayCanvas = null; this.octx = null;
    if (this.antsTimer !== null) { window.clearInterval(this.antsTimer); this.antsTimer = null; }
  }
  public setSelectedRange(range: RangeAddress | undefined): void { this.selectedRange = range; this.invalidateAll(); }
  public setSelection(range: RangeAddress | undefined, kind: SelectionKind | undefined, activeCell?: CellAddress): void {
    const prev = this.selectedRange;
    const prevActive = this.activeCell;
    this.selectedRange = range; this.selectionKind = kind; this.activeCell = activeCell;
    // Only scroll when the active cell moves — re-sync from React must not yank scroll
    // back while the user is panning under freeze panes. Whole-sheet selection (Ctrl+A /
    // corner click) never scrolls: Excel keeps the viewport where it is.
    if (kind !== 'sheet' && activeCell !== undefined && (prevActive?.r !== activeCell.r || prevActive?.c !== activeCell.c)) {
      this.ensureCellVisible(activeCell);
    }
    this.invalidateSelectionChrome(prev, range);
  }

  /** Scroll just enough so the given cell is fully inside the scrollable quadrant.
   * Cells inside a frozen strip never trigger scrolling on that axis. */
  private ensureCellVisible(cell: CellAddress): void {
    const { x, y } = this.cellVP(cell.r, cell.c);
    const w = this.scroller.getColWidth(cell.c);
    const h = this.scroller.getRowHeight(cell.r);
    let dx = 0;
    if (cell.c >= this.freeze.getFrozenCols()) {
      if (x < ROW_HEADER_WIDTH + this.frozenW()) dx = x - ROW_HEADER_WIDTH - this.frozenW();
      else if (x + w > ROW_HEADER_WIDTH + this.gridW()) dx = x + w - ROW_HEADER_WIDTH - this.gridW();
    }
    let dy = 0;
    if (cell.r >= this.freeze.getFrozenRows()) {
      if (y < COL_HEADER_HEIGHT + this.frozenH()) dy = y - COL_HEADER_HEIGHT - this.frozenH();
      else if (y + h > COL_HEADER_HEIGHT + this.gridH()) dy = y + h - COL_HEADER_HEIGHT - this.gridH();
    }
    if (dx !== 0 || dy !== 0) this.scrollBy(dx, dy);
  }
  public setSelectedCell(cell: CellAddress | undefined): void { this.setSelection(cell === undefined ? undefined : Range.single(cell.r, cell.c).toAddress(), cell === undefined ? undefined : 'cell', cell); }
  /** Excel behavior: while editing, only the edited cell keeps a border — fills and the fill handle disappear. */
  public setEditing(editing: boolean): void {
    if (this.editing === editing) return;
    this.editing = editing;
    this.invalidateSelectionChrome(this.selectedRange, this.selectedRange);
  }

  /** Selection/edit chrome: selection art lives on the overlay; grid only repaints header tint bands. */
  private invalidateSelectionChrome(prev: RangeAddress | undefined, next: RangeAddress | undefined): void {
    const pad = 8;
    const mark = (range: RangeAddress | undefined): void => {
      if (range === undefined) return;
      const { x, y, w, h } = this.rangeRect(range);
      this.dirty.invalidate({ x: 0, y: Math.max(0, y - pad), w: ROW_HEADER_WIDTH + 2, h: h + pad * 2 });
      this.dirty.invalidate({ x: Math.max(0, x - pad), y: 0, w: w + pad * 2, h: COL_HEADER_HEIGHT + 2 });
    };
    mark(prev);
    mark(next);
    this.scheduleRender();
  }

  public invalidateAll(): void { this.blitValid = false; this.dirty.invalidateAll(); this.scheduleRender(); }

  /** Show/clear the marching-ants border around a copied or cut source range (Excel). */
  public setClipboardRange(range: RangeAddress | undefined): void {
    this.clipboardRange = range;

    if (range !== undefined && this.antsTimer === null && typeof window !== 'undefined' && typeof window.setInterval === 'function') {
      this.antsTimer = window.setInterval(() => {
        this.antsOffset = (this.antsOffset + 1) % 8;
        this.paintOverlay(this.cachedTheme ?? (this.cachedTheme = readCanvasTheme()));
      }, 120);
    } else if (range === undefined && this.antsTimer !== null) {
      window.clearInterval(this.antsTimer);
      this.antsTimer = null;
    }
    this.scheduleRender();
  }
  /** True while marching ants cover the given selection: the ants replace its solid
   * border and fill handle (Excel copy/cut on the selected range). */
  private antsReplaceSelection(sr: RangeAddress | undefined): boolean {
    const cb = this.clipboardRange;
    return cb !== undefined && sr !== undefined
      && cb.r1 === sr.r1 && cb.c1 === sr.c1 && cb.r2 === sr.r2 && cb.c2 === sr.c2;
  }
  public setFreeze(rows: number, cols: number): void {
    this.freeze.freezeAt(rows, cols);
    // Excel: after Freeze Panes, the unfrozen pane starts at the freeze corner (scroll origin).
    this.scroller.setScroll(0, 0);
    this.blitValid = false;
    this.invalidateAll();
  }
  public setHighlightMatches(cells: readonly CellAddress[]): void { this.highlightMatches = cells; this.invalidateAll(); }

  private bindEvents(): void {
    if (!this.opts.canvas.hasAttribute('tabindex')) this.opts.canvas.tabIndex = 0;
    const c = this.opts.canvas;
    c.addEventListener('mousedown', this.handleMouseDown); c.addEventListener('dblclick', this.handleDblClick); c.addEventListener('contextmenu', this.handleContextMenu);
    c.addEventListener('wheel', this.handleWheel, { passive: false });
    window.addEventListener('mousemove', this.handleMouseMove); window.addEventListener('mouseup', this.handleMouseUp);
    window.addEventListener('ss:theme-changed', this.handleThemeChanged);
  }
  private unbindEvents(): void {
    const c = this.opts.canvas;
    c.removeEventListener('mousedown', this.handleMouseDown); c.removeEventListener('dblclick', this.handleDblClick); c.removeEventListener('contextmenu', this.handleContextMenu);
    c.removeEventListener('wheel', this.handleWheel);
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
    const filter = this.autoFilterAtPoint(ev.clientX, ev.clientY);
    if (filter !== null) {
      this.opts.canvas.focus();
      this.dragAnchor = null;
      this.opts.onAutoFilterClick?.(filter.r, filter.c, ev.clientX, ev.clientY);
      return;
    }
    this.opts.canvas.focus();
    if (this.selectedRange !== undefined && !this.antsReplaceSelection(this.selectedRange) && this.isSelectionBorderHit(ev.clientX, ev.clientY) && this.moveDrag === null) {
      this.moveDrag = {
        source: this.selectedRange,
        offset: { r: cell.r - this.selectedRange.r1, c: cell.c - this.selectedRange.c1 },
        target: { r: this.selectedRange.r1, c: this.selectedRange.c1 },
        moved: false,
        copy: ev.ctrlKey || ev.metaKey,
      };
      this.opts.canvas.style.cursor = this.moveDrag.copy ? 'copy' : 'move';
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
      // Excel tracks the Ctrl modifier for the whole drag, not just the press.
      const copy = ev.ctrlKey || ev.metaKey;
      if (copy !== this.moveDrag.copy) this.opts.canvas.style.cursor = copy ? 'copy' : 'move';
      const cell = this.pointerCell(ev.clientX, ev.clientY);
      if (cell !== null) {
        const target = this.moveTargetFromPointer(this.moveDrag, cell);
        this.moveDrag = {
          ...this.moveDrag,
          target,
          copy,
          moved: this.moveDrag.moved || target.r !== this.moveDrag.source.r1 || target.c !== this.moveDrag.source.c1,
        };
        this.invalidateAll();
      } else {
        this.moveDrag = { ...this.moveDrag, copy };
      }
      return;
    }
    if (this.dragAnchor === null) {
      if (this.opts.canvas.style.cursor === '' || this.opts.canvas.style.cursor === 'move') this.opts.canvas.style.cursor = !this.antsReplaceSelection(this.selectedRange) && this.isSelectionBorderHit(ev.clientX, ev.clientY) ? 'move' : '';
      return;
    }
    if (this.dragAnchor.type === 'column') { const c = this.columnAtPoint(ev.clientX); if (c !== null) this.opts.onColumnSelect?.(c, true); return; }
    if (this.dragAnchor.type === 'row') { const r = this.rowAtPoint(ev.clientY); if (r !== null) this.opts.onRowSelect?.(r, true); return; }
    const cell = this.pointerCell(ev.clientX, ev.clientY); if (cell === null) return;
    const range = new Range({ r1: this.dragAnchor.r, c1: this.dragAnchor.c, r2: cell.r, c2: cell.c }).toAddress();
    this.setSelection(range, 'range', cell); this.opts.onSelectionChange?.(range, cell, { r: this.dragAnchor.r, c: this.dragAnchor.c });
  };
  private readonly handleMouseUp = (): void => { if (this.resizeHandler.isResizing()) { this.resizeHandler.onMouseUp(); return; } if (this.fillHandle.isDragging()) { this.fillHandle.onMouseUp(); return; } if (this.moveDrag !== null) { const d = this.moveDrag; // Dropping back onto the source is a no-op, not a move — MoveRange would clear the cells.
    if (d.moved && (d.target.r !== d.source.r1 || d.target.c !== d.source.c1)) this.opts.onMoveRange?.(d.source, Range.single(d.target.r, d.target.c).toAddress(), d.copy); this.moveDrag = null; this.opts.canvas.style.cursor = ''; this.invalidateAll(); return; } this.dragAnchor = null; };
  private readonly handleDblClick = (ev: MouseEvent): void => {
    if (this.resizeHandler.onDblClick(ev)) { ev.stopPropagation(); return; }
    // Excel: double-clicking the fill handle fills down to match adjacent columns.
    if (this.fillHandle.isHandleAt(ev.clientX, ev.clientY) && this.selectedRange !== undefined) {
      const target = doubleClickFillTarget(this.opts.store, this.selectedRange, TOTAL_ROWS);
      if (target !== undefined) this.opts.onFill?.(this.selectedRange, target, false);
    }
  };
  /** Excel: wheel scrolls vertically, Shift+wheel horizontally; deltaMode lines (Firefox) scale to pixels. */
  private readonly handleWheel = (ev: WheelEvent): void => {
    ev.preventDefault();
    const unit = ev.deltaMode === 1 ? this.defaultRowHeight() : 1;
    let dx = ev.deltaX * unit;
    let dy = ev.deltaY * unit;
    if (ev.shiftKey && dx === 0) { dx = dy; dy = 0; }
    this.scrollBy(dx, dy);
  };
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
    const resized = this.syncViewport();
    if (resized) this.dirty.invalidateAll();
    const theme = this.cachedTheme ?? (this.cachedTheme = readCanvasTheme());
    const vis = this.scroller.getVisibleRange();
    const painted = !this.dirty.isEmpty();
    if (painted) this.dirty.drain().forEach((r) => this.paintRegion(r, vis, theme));
    if (painted) this.snapshotGrid();
    this.paintOverlay(theme);
  }

  /** Copy the freshly painted grid into the blit snapshot. */
  private snapshotGrid(): void {
    this.setupBlit();
    if (this.blitCanvas === null) return;
    const bctx = this.blitCanvas.getContext('2d');
    if (bctx === null || typeof bctx.drawImage !== 'function') return;
    if (this.freeze.isFrozen()) { this.blitValid = false; return; }
    if (typeof bctx.setTransform === 'function') bctx.setTransform(1, 0, 0, 1, 0, 0);
    if (typeof bctx.clearRect === 'function') bctx.clearRect(0, 0, this.blitCanvas.width, this.blitCanvas.height);
    bctx.drawImage(this.opts.canvas, 0, 0);
    this.blitLeft = this.scroller.scrollLeft;
    this.blitTop = this.scroller.scrollTop;
    this.blitValid = true;
  }

  /** Scroll the grid; reuses the blit snapshot so only exposed bands repaint. */
  public scrollBy(dx: number, dy: number): void {
    const maxLeft = Math.max(0, this.scroller.totalWidth() - this.gridW());
    const maxTop = Math.max(0, this.scroller.totalHeight() - this.gridH());
    const left = Math.min(maxLeft, Math.max(0, this.scroller.scrollLeft + dx));
    const top = Math.min(maxTop, Math.max(0, this.scroller.scrollTop + dy));
    if (left === this.scroller.scrollLeft && top === this.scroller.scrollTop) return;
    const canBlit = this.blitValid && this.blitCanvas !== null && !this.freeze.isFrozen() && typeof this.ctx.drawImage === 'function';
    if (canBlit && this.blitCanvas !== null) {
      const shiftX = this.blitLeft - left;
      const shiftY = this.blitTop - top;
      this.scroller.setScroll(top, left);
      // Shift the previous frame, then repaint only the exposed bands.
      this.ctx.save();
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.clearRect(0, 0, this.opts.canvas.width, this.opts.canvas.height);
      this.ctx.restore();
      this.ctx.drawImage(this.blitCanvas, 0, 0, this.blitCanvas.width, this.blitCanvas.height, shiftX, shiftY, this.vpW(), this.vpH());
      this.blitValid = false;
      if (shiftY > 0) this.dirty.invalidate({ x: 0, y: 0, w: this.vpW(), h: shiftY });
      else if (shiftY < 0) this.dirty.invalidate({ x: 0, y: this.vpH() + shiftY, w: this.vpW(), h: -shiftY });
      if (shiftX > 0) this.dirty.invalidate({ x: 0, y: 0, w: shiftX, h: this.vpH() });
      else if (shiftX < 0) this.dirty.invalidate({ x: this.vpW() + shiftX, y: 0, w: -shiftX, h: this.vpH() });
      // Headers are pinned: the blit shift moved them, so repaint both header strips.
      this.dirty.invalidate({ x: 0, y: 0, w: this.vpW(), h: COL_HEADER_HEIGHT });
      this.dirty.invalidate({ x: 0, y: 0, w: ROW_HEADER_WIDTH, h: this.vpH() });
      this.scheduleRender();
      return;
    }
    this.scroller.setScroll(top, left);
    this.invalidateAll();
  }

  /** Repaint the whole overlay canvas (selection chrome + transient drag art). */
  private paintOverlay(theme: CanvasTheme): void {
    const ctx = this.octx;
    if (ctx === null || this.overlayCanvas === null) {
      // Fallback (tests / no DOM): paint onto the grid canvas as before.
      this.paintSelection(this.ctx, theme);
      this.paintOverlays(this.ctx, theme);
      return;
    }
    if (typeof ctx.clearRect === 'function') ctx.clearRect(0, 0, this.vpW(), this.vpH());
    this.paintSelection(ctx, theme);
    this.paintOverlays(ctx, theme);
  }
  /** @returns true when the canvas bitmap was recreated (content cleared). */
  private syncViewport(): boolean {
    const resized = this.setupCanvas();
    // Keep the full grid viewport: cells partially hidden under the frozen strips
    // stay in the visible range and are clipped per quadrant when painted.
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
    this.syncOverlaySize(w, h, dpr);
    return true;
  }

  private paintRegion(region: Rect, vis: VisibleRange, theme: CanvasTheme): void {
    // Clamp dirty clip to the canvas — a MAX_SAFE_INTEGER rect (invalidateAll) nested with
    // freeze quadrant clips can blank the scrollable panes on some GPUs/browsers.
    const rr = this.clampToViewport(region);
    if (rr.w <= 0 || rr.h <= 0) return;
    this.ctx.save(); this.ctx.beginPath(); this.ctx.rect(rr.x, rr.y, rr.w, rr.h); this.ctx.clip();
    this.ctx.fillStyle = theme.bg; this.ctx.fillRect(0, 0, this.vpW(), this.vpH());
    const quads = this.paintQuads(vis);
    this.paintHeaders(vis, theme);
    this.borderEdges.clear();
    // Excel overflow: paint fills first, then grid/borders, then text on top so long text spans empty cells
    this.paintCellBackgrounds(quads, this.borderVis(vis), theme);
    this.collectVisibleBorders(this.borderVis(vis));
    for (const q of quads) { this.paintGridLines(q, theme); this.flushBorders(q.clip); }
    this.paintCellTexts(quads, this.borderVis(vis), theme);
    this.paintFreezeSeparators(theme);
    this.ctx.restore();
  }

  /** Row×col tiles to paint, each clipped to its quadrant: the scrollable area plus
   * frozen strips/corner. Unfrozen grids yield exactly [vis] — identical to the
   * previous single pass. */
  private paintQuads(vis: VisibleRange): PaintQuad[] {
    const fr = this.freeze.getFrozenRows();
    const fc = this.freeze.getFrozenCols();
    const fw = this.frozenW();
    const fh = this.frozenH();
    // First cells that can appear at the freeze edge (Excel unfrozen pane origin).
    const edgeRow = this.scroller.rowAtPixel(this.scroller.scrollTop + (fr === 0 ? 0 : this.scroller.cellToPixel(fr, 0).y));
    const edgeCol = this.scroller.colAtPixel(this.scroller.scrollLeft + (fc === 0 ? 0 : this.scroller.cellToPixel(0, fc).x));
    const r0 = Math.max(fr, Math.min(vis.startRow, edgeRow));
    const c0 = Math.max(fc, Math.min(vis.startCol, edgeCol));
    const quads: PaintQuad[] = [{
      r0, r1: vis.endRow, c0, c1: vis.endCol,
      clip: { x: ROW_HEADER_WIDTH + fw, y: COL_HEADER_HEIGHT + fh, w: this.gridW() - fw, h: this.gridH() - fh },
    }];
    if (fr > 0) quads.push({
      r0: 0, r1: fr, c0, c1: vis.endCol,
      clip: { x: ROW_HEADER_WIDTH + fw, y: COL_HEADER_HEIGHT, w: this.gridW() - fw, h: fh },
    });
    if (fc > 0) quads.push({
      r0, r1: vis.endRow, c0: 0, c1: fc,
      clip: { x: ROW_HEADER_WIDTH, y: COL_HEADER_HEIGHT + fh, w: fw, h: this.gridH() - fh },
    });
    if (fr > 0 && fc > 0) quads.push({
      r0: 0, r1: fr, c0: 0, c1: fc,
      clip: { x: ROW_HEADER_WIDTH, y: COL_HEADER_HEIGHT, w: fw, h: fh },
    });
    return quads;
  }

  /** Range whose borders must be collected: scrollable window plus the always-visible frozen strips. */
  private borderVis(vis: VisibleRange): VisibleRange {
    const fr = this.freeze.getFrozenRows();
    const fc = this.freeze.getFrozenCols();
    if (fr === 0 && fc === 0) return vis;
    return { startRow: 0, endRow: vis.endRow, startCol: 0, endCol: vis.endCol };
  }

  private paintHeaders(vis: VisibleRange, theme: CanvasTheme): void {
    this.ctx.fillStyle = theme.headerBg; this.ctx.fillRect(0, 0, this.vpW(), COL_HEADER_HEIGHT); this.ctx.fillRect(0, 0, ROW_HEADER_WIDTH, this.vpH());
    // Excel header chrome: light gray cells, hairline separators, dark-gray labels (no AutoFilter chevrons by default)
    this.ctx.textAlign = 'center'; this.ctx.textBaseline = 'middle';
    const headerFont = `${Math.max(11, Math.round(11 * this.zoom()))}px ${theme.fontFamily}`;
    this.ctx.font = headerFont;
    const headerText = cssHeaderText(theme);
    const fc = this.freeze.getFrozenCols();
    const fr = this.freeze.getFrozenRows();
    const fw = this.frozenW();
    const fh = this.frozenH();
    // Each pane segment clips at its freeze line: scrollable labels slide under the
    // frozen strip instead of painting over the pinned frozen labels (Excel quadrant
    // behavior), and partially scrolled labels never bleed into the corner.
    // Frozen column letters stay pinned inside the frozen segment.
    if (fc > 0) {
      this.ctx.save();
      this.ctx.beginPath();
      this.ctx.rect(ROW_HEADER_WIDTH, 0, fw, COL_HEADER_HEIGHT);
      this.ctx.clip();
      const frozenColXs: number[] = [];
      for (let c = 0; c < fc; c += 1) {
        const w = this.scroller.getColWidth(c);
        const x = this.cellVP(0, c).x;
        const level = this.colHeaderLevel(c);
        this.paintHeaderHighlight(level, x + 0.5, 0.5, w - 1, COL_HEADER_HEIGHT - 1, theme);
        this.ctx.fillStyle = level === 'solid' ? theme.bg : headerText;
        this.ctx.fillText(num2alpha(c), x + w / 2, COL_HEADER_HEIGHT / 2);
        frozenColXs.push(x + w);
      }
      this.strokeColHeaderHairlines(frozenColXs, theme);
      this.ctx.restore();
    }
    // Scrollable column letters start at the frozen edge.
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.rect(ROW_HEADER_WIDTH + fw, 0, this.vpW() - ROW_HEADER_WIDTH - fw, COL_HEADER_HEIGHT);
    this.ctx.clip();
    const colXs: number[] = [];
    let x = this.cellVP(0, Math.max(fc, vis.startCol)).x;
    colXs.push(x);
    for (let c = Math.max(fc, vis.startCol); c < vis.endCol; c += 1) {
      const w = this.scroller.getColWidth(c);
      const level = this.colHeaderLevel(c);
      this.paintHeaderHighlight(level, x + 0.5, 0.5, w - 1, COL_HEADER_HEIGHT - 1, theme);
      this.ctx.fillStyle = level === 'solid' ? theme.bg : headerText;
      this.ctx.fillText(num2alpha(c), x + w / 2, COL_HEADER_HEIGHT / 2);
      x += w;
      colXs.push(x);
    }
    this.strokeColHeaderHairlines(colXs, theme);
    this.ctx.restore();
    // Frozen row numbers stay pinned inside the frozen segment.
    if (fr > 0) {
      this.ctx.save();
      this.ctx.beginPath();
      this.ctx.rect(0, COL_HEADER_HEIGHT, ROW_HEADER_WIDTH, fh);
      this.ctx.clip();
      const frozenRowYs: number[] = [];
      for (let r = 0; r < fr; r += 1) {
        const h = this.scroller.getRowHeight(r);
        if (this.opts.store.getRow(r)?.hide !== true) {
          const y = this.cellVP(r, 0).y;
          const level = this.rowHeaderLevel(r);
          this.paintHeaderHighlight(level, 0.5, y + 0.5, ROW_HEADER_WIDTH - 1, h - 1, theme);
          // Excel colors the surviving row numbers blue while a filter hides rows.
          this.ctx.fillStyle = level === 'solid' ? theme.bg : this.filteredRowNumberColor(r, theme);
          this.ctx.fillText(String(r + 1), ROW_HEADER_WIDTH / 2, y + h / 2);
          frozenRowYs.push(y + h);
        }
      }
      this.strokeRowHeaderHairlines(frozenRowYs, theme);
      this.ctx.restore();
    }
    // Scrollable row numbers start below the frozen strip.
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.rect(0, COL_HEADER_HEIGHT + fh, ROW_HEADER_WIDTH, this.vpH() - COL_HEADER_HEIGHT - fh);
    this.ctx.clip();
    const rowYs: number[] = [];
    let y = this.cellVP(Math.max(fr, vis.startRow), 0).y;
    rowYs.push(y);
    for (let r = Math.max(fr, vis.startRow); r < vis.endRow; r += 1) {
      const h = this.scroller.getRowHeight(r);
      if (this.opts.store.getRow(r)?.hide !== true) {
        const level = this.rowHeaderLevel(r);
        this.paintHeaderHighlight(level, 0.5, y + 0.5, ROW_HEADER_WIDTH - 1, h - 1, theme);
        // Excel colors the surviving row numbers blue while a filter hides rows.
        this.ctx.fillStyle = level === 'solid' ? theme.bg : this.filteredRowNumberColor(r, theme);
        this.ctx.fillText(String(r + 1), ROW_HEADER_WIDTH / 2, y + h / 2);
        rowYs.push(y + h);
      }
      y += h;
    }
    this.strokeRowHeaderHairlines(rowYs, theme);
    this.ctx.restore();
    if (this.selectionKind === 'sheet') { this.ctx.fillStyle = headerSelectionColor(theme); this.ctx.fillRect(1, 1, ROW_HEADER_WIDTH - 2, COL_HEADER_HEIGHT - 2); }
    // Strip boundary edges (drawn after the clipped sections so highlights stay under them)
    this.ctx.strokeStyle = theme.border;
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.ctx.moveTo(0.5, COL_HEADER_HEIGHT - 0.5); this.ctx.lineTo(this.vpW(), COL_HEADER_HEIGHT - 0.5);
    this.ctx.moveTo(ROW_HEADER_WIDTH - 0.5, 0.5); this.ctx.lineTo(ROW_HEADER_WIDTH - 0.5, this.vpH());
    this.ctx.stroke();
    this.paintAutoFilterIcons(vis, theme);
  }

  /** Hairline separators between column header cells (clipped to the column strip). */
  private strokeColHeaderHairlines(colXs: number[], theme: CanvasTheme): void {
    this.ctx.strokeStyle = theme.border;
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    for (const vx of colXs) {
      const lx = Math.round(vx) + 0.5;
      this.ctx.moveTo(lx, 0.5); this.ctx.lineTo(lx, COL_HEADER_HEIGHT - 0.5);
    }
    this.ctx.stroke();
  }

  /** Hairline separators between row header cells (clipped to the row strip). */
  private strokeRowHeaderHairlines(rowYs: number[], theme: CanvasTheme): void {
    this.ctx.strokeStyle = theme.border;
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    for (const hy of rowYs) {
      const ly = Math.round(hy) + 0.5;
      this.ctx.moveTo(0.5, ly); this.ctx.lineTo(ROW_HEADER_WIDTH - 0.5, ly);
    }
    this.ctx.stroke();
  }

  /** Excel paints visible row numbers blue inside the AutoFilter range while criteria hide rows. */
  private filteredRowNumberColor(r: number, theme: CanvasTheme): string {
    const filter = this.opts.store.getAutoFilter();
    if (filter === undefined || Object.keys(filter.criteria).length === 0) return cssHeaderText(theme);
    return r > filter.range.r1 && r <= filter.range.r2 ? FILTERED_ROW_NUMBER_COLOR : cssHeaderText(theme);
  }

  private paintAutoFilterIcons(vis: VisibleRange, theme: CanvasTheme): void {
    const filter = this.opts.store.getAutoFilter();
    if (filter === undefined) return;
    // Excel draws the dropdown button inside each header-row cell, not on
    // the column-letter header.
    const headerRow = filter.range.r1;
    const fr = this.freeze.getFrozenRows();
    const fc = this.freeze.getFrozenCols();
    const fw = this.frozenW();
    const fh = this.frozenH();
    const frozenVisible = headerRow < fr;
    if (!frozenVisible && (headerRow < vis.startRow || headerRow >= vis.endRow)) return;
    // Icons live inside cells, so each icon clips to its cell's quadrant: a header
    // row/column sliding under a frozen strip must not bleed its icon over pinned cells.
    const quadY = frozenVisible ? COL_HEADER_HEIGHT : COL_HEADER_HEIGHT + fh;
    const quadH = frozenVisible ? fh : this.vpH() - COL_HEADER_HEIGHT - fh;
    const rowHeight = this.scroller.getRowHeight(headerRow);
    const { y } = this.cellVP(headerRow, filter.range.c1);
    const first = Math.max(vis.startCol, filter.range.c1);
    const last = Math.min(vis.endCol - 1, filter.range.c2);
    for (let c = first; c <= last; c += 1) {
      const { x } = this.cellVP(headerRow, c);
      const w = this.scroller.getColWidth(c);
      const active = filter.criteria[c] !== undefined;
      this.ctx.save();
      this.ctx.beginPath();
      this.ctx.rect(c < fc ? ROW_HEADER_WIDTH : ROW_HEADER_WIDTH + fw, quadY, c < fc ? fw : this.vpW() - ROW_HEADER_WIDTH - fw, quadH);
      this.ctx.clip();
      this.paintAutoFilterIcon(x + w - AUTO_FILTER_BUTTON_WIDTH - 4, y + rowHeight / 2, theme, active);
      this.ctx.restore();
    }
  }

  private paintAutoFilterIcon(x: number, y: number, theme: CanvasTheme, active: boolean): void {
    this.ctx.save();
    this.ctx.fillStyle = active ? theme.accent : cssHeaderText(theme);
    this.ctx.strokeStyle = this.ctx.fillStyle;
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    if (active) {
      // Excel's active funnel icon
      const left = x + 2;
      const right = x + AUTO_FILTER_BUTTON_WIDTH - 2;
      const top = y - 5;
      const bottom = y + 6;
      this.ctx.moveTo(left, top); this.ctx.lineTo(right, top);
      this.ctx.lineTo(x + AUTO_FILTER_BUTTON_WIDTH / 2 + 1, y + 1);
      this.ctx.lineTo(x + AUTO_FILTER_BUTTON_WIDTH / 2 + 1, bottom);
      this.ctx.lineTo(x + AUTO_FILTER_BUTTON_WIDTH / 2 - 1, bottom - 1);
      this.ctx.lineTo(x + AUTO_FILTER_BUTTON_WIDTH / 2 - 1, y + 1);
      this.ctx.closePath();
      this.ctx.fill();
    } else {
      // Excel's idle dropdown chevron
      this.ctx.moveTo(x + 4, y - 2);
      this.ctx.lineTo(x + AUTO_FILTER_BUTTON_WIDTH / 2, y + 3);
      this.ctx.lineTo(x + AUTO_FILTER_BUTTON_WIDTH - 4, y - 2);
      this.ctx.stroke();
    }
    this.ctx.restore();
  }

  private paintCellBackgrounds(quads: PaintQuad[], vis: VisibleRange, theme: CanvasTheme): void {
    const skip = this.mergeSkipSet(vis);
    for (const q of quads) {
      this.withClip(q.clip, () => {
        for (let r = q.r0; r < q.r1; r += 1) {
          const rowMeta = this.opts.store.getRow(r);
          if (rowMeta?.hide === true) continue;
          for (let c = q.c0; c < q.c1; c += 1) {
            if (skip.has(`${r},${c}`)) continue;
            const merge = this.opts.store.getMergeAt(r, c);
            if (merge !== undefined) {
              const mr = parseRange(merge);
              const rect = this.rangeRect(mr);
              this.paintCellFillOnly(mr.r1, mr.c1, rect.x, rect.y, rect.w, rect.h, theme);
              continue;
            }
            const { x, y } = this.cellVP(r, c);
            const cw = this.scroller.getColWidth(c);
            const rh = this.scroller.getRowHeight(r);
            if (!this.rectsIntersect(x, y, cw, rh, q.clip)) continue;
            this.paintCellFillOnly(r, c, x, y, cw, rh, theme);
          }
        }
      });
    }
  }

  private paintCellTexts(quads: PaintQuad[], vis: VisibleRange, theme: CanvasTheme): void {
    const skip = this.mergeSkipSet(vis);
    for (const q of quads) {
      this.withClip(q.clip, () => {
        for (let r = q.r0; r < q.r1; r += 1) {
          const rowMeta = this.opts.store.getRow(r);
          if (rowMeta?.hide === true) continue;
          for (let c = q.c0; c < q.c1; c += 1) {
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
            const cw = this.scroller.getColWidth(c);
            const rh = this.scroller.getRowHeight(r);
            // Still paint when the cell itself is outside but text may overflow into the clip
            // (Excel overflow). Cheap reject only when fully away on the scroll axis of this pane.
            if (!this.rectsIntersect(x - cw, y, cw * 3, rh, q.clip)) continue;
            const style = this.mergedPaintStyle(r, c);
            this.paintTextWith(r, c, x, y, cw, rh, theme, style);
          }
        }
      });
    }
  }

  /** Run `paint` clipped to a viewport rect (quadrant separation). */
  private withClip(clip: Rect, paint: () => void): void {
    if (clip.w <= 0 || clip.h <= 0) return;
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.rect(clip.x, clip.y, clip.w, clip.h);
    this.ctx.clip();
    paint();
    this.ctx.restore();
  }

  private mergedPaintStyle(r: number, c: number): Style | undefined {
    const style = this.cellStyle(r, c);
    const overlay = this.conditionalService.computeOverlay(this.opts.store, r, c);
    return { ...style, ...overlay.style };
  }


  /** Excel hairline grid: one stroke per shared edge; skip where a style border already owns the edge.
   * Painted per quadrant so frozen strips never receive scrollable-axis lines (and vice versa).
   * Frozen-strip edges must use the pinned freeze line — never cellVP of the first unfrozen
   * row/col (that slides under on scroll and would collapse the strip grid). */
  private paintGridLines(q: PaintQuad, theme: CanvasTheme): void {
    if (this.opts.showGrid === false) return;
    if (q.clip.w <= 0 || q.clip.h <= 0) return;
    const colCount = q.c1 - q.c0;
    const rowCount = q.r1 - q.r0;
    if (colCount <= 0 || rowCount <= 0) return;
    const fr = this.freeze.getFrozenRows();
    const fc = this.freeze.getFrozenCols();
    const frozenRowQuad = fr > 0 && q.r1 <= fr;
    const frozenColQuad = fc > 0 && q.c1 <= fc;
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.rect(q.clip.x, q.clip.y, q.clip.w, q.clip.h);
    this.ctx.clip();
    this.ctx.strokeStyle = theme.grid;
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();

    const xs: number[] = new Array(colCount + 1);
    const ys: number[] = new Array(rowCount + 1);
    for (let i = 0; i <= colCount; i += 1) {
      const c = q.c0 + i;
      xs[i] = this.gridLineX(c, frozenColQuad);
    }
    for (let j = 0; j <= rowCount; j += 1) {
      const r = q.r0 + j;
      ys[j] = this.gridLineY(r, frozenRowQuad);
    }
    for (let i = 0; i <= colCount; i += 1) {
      const c = q.c0 + i;
      const lx = xs[i]!;
      for (let j = 0; j < rowCount; j += 1) {
        const r = q.r0 + j;
        if (hasBorderOnEdge(this.borderEdges, 'v', c, r)) continue;
        this.ctx.moveTo(lx, ys[j]!);
        this.ctx.lineTo(lx, ys[j + 1]!);
      }
    }
    for (let j = 0; j <= rowCount; j += 1) {
      const r = q.r0 + j;
      const ly = ys[j]!;
      for (let i = 0; i < colCount; i += 1) {
        const c = q.c0 + i;
        if (hasBorderOnEdge(this.borderEdges, 'h', r, c)) continue;
        this.ctx.moveTo(xs[i]!, ly);
        this.ctx.lineTo(xs[i + 1]!, ly);
      }
    }
    this.ctx.stroke();
    this.ctx.restore();
  }

  /** X of a vertical grid line. In a frozen-col pane, c===fc is the freeze edge (pinned). */
  private gridLineX(c: number, frozenColQuad: boolean): number {
    const fc = this.freeze.getFrozenCols();
    if (c >= TOTAL_COLS) {
      return Math.round(this.cellVP(0, TOTAL_COLS - 1).x + this.scroller.getColWidth(TOTAL_COLS - 1)) + 0.5;
    }
    if (frozenColQuad) {
      const x = c < fc ? this.scroller.cellToPixel(0, c).x : this.frozenW();
      return Math.round(ROW_HEADER_WIDTH + x) + 0.5;
    }
    if (c < fc) return Math.round(ROW_HEADER_WIDTH + this.scroller.cellToPixel(0, c).x) + 0.5;
    return Math.round(this.cellVP(0, c).x) + 0.5;
  }

  /** Y of a horizontal grid line. In a frozen-row pane, r===fr is the freeze edge (pinned). */
  private gridLineY(r: number, frozenRowQuad: boolean): number {
    const fr = this.freeze.getFrozenRows();
    if (r >= TOTAL_ROWS) {
      return Math.round(this.cellVP(TOTAL_ROWS - 1, 0).y + this.scroller.getRowHeight(TOTAL_ROWS - 1)) + 0.5;
    }
    if (frozenRowQuad) {
      const y = r < fr ? this.scroller.cellToPixel(r, 0).y : this.frozenH();
      return Math.round(COL_HEADER_HEIGHT + y) + 0.5;
    }
    if (r < fr) return Math.round(COL_HEADER_HEIGHT + this.scroller.cellToPixel(r, 0).y) + 0.5;
    return Math.round(this.cellVP(r, 0).y) + 0.5;
  }



  private paintCellFillOnly(r: number, c: number, x: number, y: number, cw: number, rh: number, _theme: CanvasTheme): void {
    const style = this.cellStyle(r, c);
    const overlay = this.conditionalService.computeOverlay(this.opts.store, r, c);
    const merged = { ...style, ...overlay.style };
    if (merged.bgcolor !== undefined) { this.ctx.fillStyle = merged.bgcolor; this.ctx.fillRect(x + 1, y + 1, cw - 2, rh - 2); }
    if (overlay.dataBar !== undefined) { this.paintDataBar(x, y, cw, rh, overlay.dataBar.ratio, overlay.dataBar.color); }
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

  /** Stroke resolved borders once per logical edge (Excel: no missing, no double). Also while editing.
   * Clipped to the given quadrant rect — edges of cells sliding under a frozen strip stay hidden. */
  private flushBorders(clip: Rect): void {
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
    strokeBorderSegs(this.ctx, segs, this.zoom(), clip);
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
    const valign = style?.valign ?? 'middle';
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
    const fontStr = `${style?.italic === true ? 'italic ' : ''}${style?.bold === true ? 'bold ' : ''}${fontSize}px ${fontFamily}`;
    this.ctx.font = fontStr;
    const tx = align === 'center' ? x + cw / 2 : align === 'right' ? x + cw - 3 : x + 3;
    const maxW = Math.max(4, cw - 6);
    const lines = wrapping ? wrapTextLines((t) => this.textMetrics.measure(this.ctx, fontStr, t), text, maxW) : [text.replace(/\r?\n/g, '')];
    const lineH = fontSize * WRAP_LINE_HEIGHT;
    const contentHeight = lines.length * lineH;
    const contentTop = valign === 'top'
      ? y + 2
      : valign === 'middle'
        ? y + rh / 2 - contentHeight / 2
        : y + rh - 2 - contentHeight;
    const startY = contentTop + lineH / 2;
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]!;
      const ly = startY + i * lineH;
      if (ly > y + rh) break;
      this.ctx.fillText(line, tx, ly);
      if (style?.underline === true) {
        const w = this.textMetrics.measure(this.ctx, fontStr, line);
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

  /** Excel-style selection: translucent accent fill, 2px border, white active cell, corner fill handle.
   * When frozen, paint per quadrant and clip so a scrollable cell that has slid under the
   * freeze strips never draws on top of pinned frozen cells (e.g. C3 must not look like B2). */
  private paintSelection(ctx: CanvasRenderingContext2D, theme: CanvasTheme): void {
    const sr = this.selectedRange;
    if (sr === undefined) return;
    const kind = this.selectionKind ?? 'cell';
    const segments = this.selectionSegments(sr);
    for (const seg of segments) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(seg.clip.x, seg.clip.y, seg.clip.w, seg.clip.h);
      ctx.clip();
      this.paintSelectionInClip(ctx, theme, seg.range, kind, sr);
      ctx.restore();
    }
  }

  /** Split a selection into freeze-quadrant pieces. Each piece is clipped to its pane so
   * geometry from cells under a freeze strip is discarded instead of painting on frozen cells. */
  private selectionSegments(sr: RangeAddress): Array<{ range: RangeAddress; clip: Rect }> {
    const fr = this.freeze.getFrozenRows();
    const fc = this.freeze.getFrozenCols();
    if (fr === 0 && fc === 0) {
      return [{ range: sr, clip: { x: ROW_HEADER_WIDTH, y: COL_HEADER_HEIGHT, w: this.gridW(), h: this.gridH() } }];
    }
    const fw = this.frozenW();
    const fh = this.frozenH();
    const out: Array<{ range: RangeAddress; clip: Rect }> = [];
    const push = (r1: number, c1: number, r2: number, c2: number, clip: Rect): void => {
      if (r1 > r2 || c1 > c2) return;
      out.push({ range: { r1, c1, r2, c2 }, clip });
    };
    // Scrollable quadrant (bottom-right)
    push(Math.max(sr.r1, fr), Math.max(sr.c1, fc), sr.r2, sr.c2, {
      x: ROW_HEADER_WIDTH + fw, y: COL_HEADER_HEIGHT + fh, w: this.gridW() - fw, h: this.gridH() - fh,
    });
    // Frozen rows × scrollable cols (top strip)
    if (fr > 0) {
      push(sr.r1, Math.max(sr.c1, fc), Math.min(sr.r2, fr - 1), sr.c2, {
        x: ROW_HEADER_WIDTH + fw, y: COL_HEADER_HEIGHT, w: this.gridW() - fw, h: fh,
      });
    }
    // Scrollable rows × frozen cols (left strip)
    if (fc > 0) {
      push(Math.max(sr.r1, fr), sr.c1, sr.r2, Math.min(sr.c2, fc - 1), {
        x: ROW_HEADER_WIDTH, y: COL_HEADER_HEIGHT + fh, w: fw, h: this.gridH() - fh,
      });
    }
    // Frozen corner
    if (fr > 0 && fc > 0) {
      push(sr.r1, sr.c1, Math.min(sr.r2, fr - 1), Math.min(sr.c2, fc - 1), {
        x: ROW_HEADER_WIDTH, y: COL_HEADER_HEIGHT, w: fw, h: fh,
      });
    }
    return out;
  }

  private paintSelectionInClip(
    ctx: CanvasRenderingContext2D,
    theme: CanvasTheme,
    range: RangeAddress,
    kind: SelectionKind,
    full: RangeAddress,
  ): void {
    const { x, y, w, h } = this.rangeRect(range);
    // While editing: CSS overlay is borderless input only. Canvas keeps the 2px accent
    // strokeRect (same geometry as normal selection) so it covers style borders the same
    // way — including bottom/right hairlines drawn at round(edge)+0.5 outside the CSS box.
    if (this.editing) {
      if (kind !== 'sheet') {
        ctx.strokeStyle = theme.accent;
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, w, h);
        ctx.lineWidth = 1;
      }
      return;
    }

    ctx.fillStyle = selectionFillColor(theme);
    const ac = this.activeCell;
    const hole = ac !== undefined && new Range(range).contains(ac.r, ac.c);
    if (!hole) {
      ctx.fillRect(x, y, w, h);
    } else {
      const ap = this.cellVP(ac.r, ac.c);
      const aw = this.scroller.getColWidth(ac.c);
      const ah = this.scroller.getRowHeight(ac.r);
      if (ap.y > y) ctx.fillRect(x, y, w, ap.y - y);
      if (ap.y + ah < y + h) ctx.fillRect(x, ap.y + ah, w, y + h - (ap.y + ah));
      if (ap.x > x) ctx.fillRect(x, ap.y, ap.x - x, ah);
      if (ap.x + aw < x + w) ctx.fillRect(ap.x + aw, ap.y, x + w - (ap.x + aw), ah);
    }

    if (kind === 'sheet') return;
    // Excel replaces the solid selection border (and fill handle) with the marching
    // ants while the copied/cut range is the selection; drawing both stacks a solid
    // line under the dashes and the animation becomes invisible.
    if (this.antsReplaceSelection(full)) return;
    // Excel centers the 2px selection stroke on the range boundary, covering the cell border beneath it
    ctx.strokeStyle = theme.accent; ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
    ctx.lineWidth = 1;
    // Fill handle only on the true bottom-right of the full selection, when that corner is in this piece
    if (range.r2 === full.r2 && range.c2 === full.c2) {
      const br = this.rangeRect(full);
      ctx.fillStyle = theme.accent;
      ctx.fillRect(br.x + br.w - 3, br.y + br.h - 3, 6, 6);
      ctx.strokeStyle = theme.bg;
      ctx.strokeRect(br.x + br.w - 3.5, br.y + br.h - 3.5, 7, 7);
    }
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

  private paintOverlays(ctx: CanvasRenderingContext2D, theme: CanvasTheme): void {
    const indicator = this.resizeHandler.getIndicator();
    if (indicator !== null) { ctx.save(); ctx.setLineDash([4, 3]); ctx.strokeStyle = theme.accent; ctx.lineWidth = 1; ctx.beginPath(); if (indicator.type === 'row') { ctx.moveTo(0, indicator.position); ctx.lineTo(this.vpW(), indicator.position); } else { ctx.moveTo(indicator.position, 0); ctx.lineTo(indicator.position, this.vpH()); } ctx.stroke(); ctx.setLineDash([]); ctx.restore(); }
    const ft = this.fillHandle.getFillTarget();
    if (ft !== undefined) {
      for (const seg of this.selectionSegments(ft)) {
        const { x, y, w, h } = this.rangeRect(seg.range);
        ctx.save();
        ctx.beginPath();
        ctx.rect(seg.clip.x, seg.clip.y, seg.clip.w, seg.clip.h);
        ctx.clip();
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = theme.accent;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x, y, w, h);
        ctx.setLineDash([]);
        ctx.restore();
      }
    }
    if (this.clipboardRange !== undefined) {
      for (const seg of this.selectionSegments(this.clipboardRange)) {
        const { x, y, w, h } = this.rangeRect(seg.range);
        ctx.save();
        ctx.beginPath();
        ctx.rect(seg.clip.x, seg.clip.y, seg.clip.w, seg.clip.h);
        ctx.clip();
        ctx.setLineDash([4, 4]);
        ctx.lineDashOffset = -this.antsOffset;
        // Double stroke (dark over light) keeps the ants visible on any fill, like Excel.
        ctx.strokeStyle = theme.bg;
        ctx.lineWidth = 2.5;
        ctx.strokeRect(x, y, w, h);
        ctx.strokeStyle = theme.text;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x, y, w, h);
        ctx.restore();
      }
    }
    this.paintMoveDragOverlay(ctx, theme);
    this.paintHighlights(ctx, theme);
  }

  /** Paint find-match highlight cells with light yellow background. */
  private paintHighlights(ctx: CanvasRenderingContext2D, _theme: CanvasTheme): void {
    if (this.highlightMatches.length === 0) return;
    ctx.save();
    for (const cell of this.highlightMatches) {
      const { x, y } = this.cellVP(cell.r, cell.c);
      ctx.fillStyle = 'rgba(255,255,0,0.3)';
      ctx.fillRect(x + 1, y + 1, this.scroller.getColWidth(cell.c) - 2, this.scroller.getRowHeight(cell.r) - 2);
    }
    ctx.restore();
  }

  /** Excel freeze separators: 1px dark gray lines that also cut through the headers. */
  private paintFreezeSeparators(theme: CanvasTheme): void {
    const fr = this.freeze.getFrozenRows();
    const fc = this.freeze.getFrozenCols();
    if (fr === 0 && fc === 0) return;
    this.ctx.save();
    this.ctx.strokeStyle = theme.freezeLine;
    this.ctx.lineWidth = 1;
    // Draw at .5 so the 1px line sits crisply on the device pixel grid (Excel hairline).
    if (fc > 0) {
      const x = Math.round(ROW_HEADER_WIDTH + this.frozenW()) + 0.5;
      this.ctx.beginPath();
      this.ctx.moveTo(x, 0);
      this.ctx.lineTo(x, this.vpH());
      this.ctx.stroke();
    }
    if (fr > 0) {
      const y = Math.round(COL_HEADER_HEIGHT + this.frozenH()) + 0.5;
      this.ctx.beginPath();
      this.ctx.moveTo(0, y);
      this.ctx.lineTo(this.vpW(), y);
      this.ctx.stroke();
    }
    this.ctx.restore();
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
    // Excel: a move never crosses the freeze boundary — the target stays in the
    // source's own region (frozen band or scrollable area) on each axis. A range
    // straddling the boundary pins to its anchor, disabling the move.
    let minR = 0;
    let maxR = TOTAL_ROWS - rows;
    if (drag.source.r2 < this.freeze.getFrozenRows()) maxR = this.freeze.getFrozenRows() - rows;
    else if (drag.source.r1 < this.freeze.getFrozenRows()) { minR = drag.source.r1; maxR = drag.source.r1; }
    else minR = this.freeze.getFrozenRows();
    let minC = 0;
    let maxC = TOTAL_COLS - cols;
    if (drag.source.c2 < this.freeze.getFrozenCols()) maxC = this.freeze.getFrozenCols() - cols;
    else if (drag.source.c1 < this.freeze.getFrozenCols()) { minC = drag.source.c1; maxC = drag.source.c1; }
    else minC = this.freeze.getFrozenCols();
    return {
      r: clamp(pointer.r - drag.offset.r, minR, Math.max(minR, maxR)),
      c: clamp(pointer.c - drag.offset.c, minC, Math.max(minC, maxC)),
    };
  }

  /** Paint the move-drag target outline (freeze-quadrant clipped, same as selection). */
  private paintMoveDragOverlay(ctx: CanvasRenderingContext2D, theme: CanvasTheme): void {
    if (this.moveDrag === null) return;
    const src = this.moveDrag.source;
    const tgt = this.moveDrag.target;
    const rows = src.r2 - src.r1 + 1;
    const cols = src.c2 - src.c1 + 1;
    const targetRange = { r1: tgt.r, c1: tgt.c, r2: tgt.r + rows - 1, c2: tgt.c + cols - 1 };
    for (const seg of this.selectionSegments(targetRange)) {
      const { x, y, w, h } = this.rangeRect(seg.range);
      ctx.save();
      ctx.beginPath();
      ctx.rect(seg.clip.x, seg.clip.y, seg.clip.w, seg.clip.h);
      ctx.clip();
      ctx.setLineDash([6, 3]);
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);
      ctx.restore();
    }
  }
  private pointerCell(cx: number, cy: number): CellAddress | null {
    const rect = this.opts.canvas.getBoundingClientRect();
    const gx = cx - rect.left - ROW_HEADER_WIDTH;
    const gy = cy - rect.top - COL_HEADER_HEIGHT;
    if (gx < 0 || gy < 0) return null;
    // Past the scrollable content end (and not inside a frozen strip) — no cell.
    if (gx >= this.frozenW() && gx + this.scroller.scrollLeft >= this.scroller.totalWidth()) return null;
    if (gy >= this.frozenH() && gy + this.scroller.scrollTop >= this.scroller.totalHeight()) return null;
    return { r: this.rowAtViewportY(cy - rect.top) as number, c: this.colAtViewportX(cx - rect.left) as number };
  }

  /** Public size-aware hit tests (scroller units are already zoomed). */
  public cellAtPoint(clientX: number, clientY: number): CellAddress | null { return this.pointerCell(clientX, clientY); }

  /** Current scroll offset (diagnostics / tests). */
  public scrollState(): { left: number; top: number } { return { left: this.scroller.scrollLeft, top: this.scroller.scrollTop }; }

  /** Viewport rect of a cell (includes scroll) — use this for the editor overlay so it matches canvas geometry. */
  public getCellViewportRect(r: number, c: number): { x: number; y: number; w: number; h: number } {
    const { x, y } = this.cellVP(r, c);
    return { x, y, w: this.scroller.getColWidth(c), h: this.scroller.getRowHeight(r) };
  }

  public columnAtPoint(clientX: number): number | null {
    const rect = this.opts.canvas.getBoundingClientRect();
    return this.colAtViewportX(clientX - rect.left);
  }

  public rowAtPoint(clientY: number): number | null {
    const rect = this.opts.canvas.getBoundingClientRect();
    return this.rowAtViewportY(clientY - rect.top);
  }

  private autoFilterAtPoint(clientX: number, clientY: number): CellAddress | null {
    const filter = this.opts.store.getAutoFilter();
    if (filter === undefined) return null;
    const cell = this.pointerCell(clientX, clientY);
    if (cell === null || cell.r !== filter.range.r1) return null;
    if (cell.c < filter.range.c1 || cell.c > filter.range.c2) return null;
    const { x } = this.cellVP(cell.r, cell.c);
    const w = this.scroller.getColWidth(cell.c);
    const px = clientX - this.opts.canvas.getBoundingClientRect().left;
    return px >= x + w - AUTO_FILTER_BUTTON_WIDTH - 6 && px <= x + w - 2 ? cell : null;
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
  /** Freeze-aware viewport position of a cell. Frozen rows/cols keep their
   * unscrolled position; scrollable content slides underneath the frozen strips
   * and is clipped at the freeze line (Excel quadrant model). */
  private cellVP(r: number, c: number): { x: number; y: number } {
    const p = this.scroller.cellToPixel(r, c);
    const fc = this.freeze.getFrozenCols();
    const fr = this.freeze.getFrozenRows();
    const fw = this.frozenW();
    const fh = this.frozenH();
    // Excel quadrants: frozen bands stay pinned; the unfrozen pane is positioned so that
    // content (fw, fh) sits at the freeze corner when scroll is 0, then slides under on scroll.
    const x = c < fc
      ? ROW_HEADER_WIDTH + p.x
      : ROW_HEADER_WIDTH + fw + (p.x - fw - this.scroller.scrollLeft);
    const y = r < fr
      ? COL_HEADER_HEIGHT + p.y
      : COL_HEADER_HEIGHT + fh + (p.y - fh - this.scroller.scrollTop);
    return { x, y };
  }
  /** Pixel width of the frozen column strip (prefix sum of frozen col widths). */
  private frozenW(): number { const fc = this.freeze.getFrozenCols(); return fc === 0 ? 0 : this.scroller.cellToPixel(0, fc).x; }
  /** Pixel height of the frozen row strip. */
  private frozenH(): number { const fr = this.freeze.getFrozenRows(); return fr === 0 ? 0 : this.scroller.cellToPixel(fr, 0).y; }
  /** Intersect a dirty rect with the canvas CSS box (avoids huge clip rects from invalidateAll). */
  private clampToViewport(region: Rect): Rect {
    const x = Math.max(0, region.x);
    const y = Math.max(0, region.y);
    const w = Math.min(region.x + region.w, this.vpW()) - x;
    const h = Math.min(region.y + region.h, this.vpH()) - y;
    return { x, y, w: Math.max(0, w), h: Math.max(0, h) };
  }
  /** Viewport x -> column index, or null left of the grid. Points inside the frozen
   * strip map without scroll; scrollable points add the scroll offset. */
  private colAtViewportX(px: number): number | null {
    const gx = px - ROW_HEADER_WIDTH;
    if (gx < 0) return null;
    const fw = this.frozenW();
    // Frozen strip: un-scrolled columns 0..fc-1
    if (gx < fw) return this.scroller.colAtPixel(gx);
    // Scrollable pane: Excel origin is the freeze edge; content x = fw + scrollLeft + local
    const content = fw + this.scroller.scrollLeft + (gx - fw);
    return content >= this.scroller.totalWidth() ? TOTAL_COLS - 1 : this.scroller.colAtPixel(content);
  }
  /** Viewport y -> row index, or null above the grid. Points inside the frozen
   * strip map without scroll; scrollable points add the scroll offset. */
  private rowAtViewportY(py: number): number | null {
    const gy = py - COL_HEADER_HEIGHT;
    if (gy < 0) return null;
    const fh = this.frozenH();
    if (gy < fh) return this.scroller.rowAtPixel(gy);
    const content = fh + this.scroller.scrollTop + (gy - fh);
    return content >= this.scroller.totalHeight() ? TOTAL_ROWS - 1 : this.scroller.rowAtPixel(content);
  }
  private rectsIntersect(x: number, y: number, w: number, h: number, clip: Rect): boolean {
    return x < clip.x + clip.w && x + w > clip.x && y < clip.y + clip.h && y + h > clip.y;
  }
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
    for (let r = 0; r < TOTAL_ROWS; r += 1) {
      const meta = this.opts.store.getRow(r);
      // Excel collapses AutoFilter-hidden rows to zero height so lower rows shift up.
      if (meta?.hide === true) this.scroller.setRowHeight(r, 0);
      else if (meta?.height !== undefined) this.scroller.setRowHeight(r, meta.height * z);
    }
    for (let c = 0; c < TOTAL_COLS; c += 1) { const w = this.opts.store.getCol(c)?.width; if (w !== undefined) this.scroller.setColWidth(c, w * z); }
  }

  private onStoreEvent(e: StoreEvent): void {
    const z = this.zoom();
    if (e.type === 'row') {
      const hidden = e.meta?.hide === true;
      const h = e.meta?.height;
      this.scroller.setRowHeight(e.r, hidden ? 0 : h !== undefined ? h * z : this.defaultRowHeight());
    }
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

