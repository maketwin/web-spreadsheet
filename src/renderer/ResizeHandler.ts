import { COL_HEADER_HEIGHT, ROW_HEADER_WIDTH } from './CanvasRenderer';
import type { VirtualScroller } from './VirtualScroller';
import type { Store } from '../store/Store';

export interface ResizeIndicator {
  readonly type: 'row' | 'col';
  readonly position: number;
}

interface ResizeDrag {
  readonly type: 'row' | 'col';
  readonly index: number;
  readonly startPos: number;
  readonly startSize: number;
  position: number;
  size: number;
}

interface BorderHit {
  readonly type: 'row' | 'col';
  readonly index: number;
  readonly canvasPos: number;
}

export interface ResizeHandlerOptions {
  canvas: HTMLCanvasElement;
  scroller: VirtualScroller;
  store: Store;
  zoom: () => number;
  onRowResize?: ((r: number, height: number) => void) | undefined;
  onColResize?: ((c: number, width: number) => void) | undefined;
  onRowDblClick?: ((r: number) => void) | undefined;
  onColDblClick?: ((c: number) => void) | undefined;
  invalidate: () => void;
}

const BORDER_THRESHOLD = 3;
const MIN_ROW_HEIGHT = 15;
const MAX_ROW_HEIGHT = 500;
const MIN_COL_WIDTH = 30;
const MAX_COL_WIDTH = 500;

export class ResizeHandler {
  private drag: ResizeDrag | null = null;

  public constructor(private readonly opts: ResizeHandlerOptions) {}

  public onMouseDown(event: MouseEvent): boolean {
    const hit = this.hitTestBorder(event.clientX, event.clientY);
    if (hit === null) return false;
    this.opts.canvas.focus();
    const size = hit.type === 'row'
      ? this.opts.scroller.getRowHeight(hit.index)
      : this.opts.scroller.getColWidth(hit.index);
    this.drag = {
      type: hit.type, index: hit.index,
      startPos: hit.type === 'row' ? event.clientY : event.clientX,
      startSize: size, position: hit.canvasPos, size,
    };
    return true;
  }

  public onMouseMove(event: MouseEvent): void {
    if (this.drag !== null) { this.updateDrag(event); return; }
    const hit = this.hitTestBorder(event.clientX, event.clientY);
    this.opts.canvas.style.cursor = hit !== null
      ? (hit.type === 'row' ? 'ns-resize' : 'ew-resize')
      : '';
  }

  public onMouseUp(): void {
    if (this.drag === null) return;
    const d = this.drag;
    const zoom = this.opts.zoom();
    if (d.type === 'row') {
      const h = Math.round(d.size / zoom);
      this.opts.onRowResize?.(d.index, clamp(h, MIN_ROW_HEIGHT, MAX_ROW_HEIGHT));
    } else {
      const w = Math.round(d.size / zoom);
      this.opts.onColResize?.(d.index, clamp(w, MIN_COL_WIDTH, MAX_COL_WIDTH));
    }
    this.drag = null;
    this.opts.invalidate();
  }

  public onDblClick(event: MouseEvent): boolean {
    const hit = this.hitTestBorder(event.clientX, event.clientY);
    if (hit === null) return false;
    if (hit.type === 'row') this.opts.onRowDblClick?.(hit.index);
    else this.opts.onColDblClick?.(hit.index);
    return true;
  }

  public getIndicator(): ResizeIndicator | null {
    if (this.drag === null) return null;
    return { type: this.drag.type, position: this.drag.position };
  }

  public isResizing(): boolean { return this.drag !== null; }

  public destroy(): void { this.drag = null; }

  private updateDrag(event: MouseEvent): void {
    const d = this.drag;
    if (d === null) return;
    const delta = d.type === 'row'
      ? event.clientY - d.startPos
      : event.clientX - d.startPos;
    const minSize = d.type === 'row' ? MIN_ROW_HEIGHT : MIN_COL_WIDTH;
    const maxSize = d.type === 'row' ? MAX_ROW_HEIGHT : MAX_COL_WIDTH;
    const zoom = this.opts.zoom();
    const scaledMin = minSize * zoom;
    const scaledMax = maxSize * zoom;
    d.size = clamp(d.startSize + delta, scaledMin, scaledMax);
    d.position = d.type === 'row'
      ? COL_HEADER_HEIGHT + this.rowBottom(d.index) - this.opts.scroller.scrollTop
        + (d.size - this.opts.scroller.getRowHeight(d.index))
      : ROW_HEADER_WIDTH + this.colRight(d.index) - this.opts.scroller.scrollLeft
        + (d.size - this.opts.scroller.getColWidth(d.index));
    this.opts.invalidate();
  }

  private hitTestBorder(clientX: number, clientY: number): BorderHit | null {
    const rect = this.opts.canvas.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    if (mx >= 0 && mx < ROW_HEADER_WIDTH) {
      const gy = my - COL_HEADER_HEIGHT + this.opts.scroller.scrollTop;
      let y = 0;
      const range = this.opts.scroller.getVisibleRange();
      for (let r = range.startRow; r < range.endRow; r += 1) {
        y += this.opts.scroller.getRowHeight(r);
        if (Math.abs(gy - y) <= BORDER_THRESHOLD) {
          return { type: 'row', index: r, canvasPos: COL_HEADER_HEIGHT + y - this.opts.scroller.scrollTop };
        }
      }
    }
    if (my >= 0 && my < COL_HEADER_HEIGHT) {
      const gx = mx - ROW_HEADER_WIDTH + this.opts.scroller.scrollLeft;
      let x = 0;
      const range = this.opts.scroller.getVisibleRange();
      for (let c = range.startCol; c < range.endCol; c += 1) {
        x += this.opts.scroller.getColWidth(c);
        if (Math.abs(gx - x) <= BORDER_THRESHOLD) {
          return { type: 'col', index: c, canvasPos: ROW_HEADER_WIDTH + x - this.opts.scroller.scrollLeft };
        }
      }
    }
    return null;
  }

  private rowBottom(r: number): number {
    let y = 0;
    for (let i = 0; i <= r; i += 1) y += this.opts.scroller.getRowHeight(i);
    return y;
  }

  private colRight(c: number): number {
    let x = 0;
    for (let i = 0; i <= c; i += 1) x += this.opts.scroller.getColWidth(i);
    return x;
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export { MIN_ROW_HEIGHT, MAX_ROW_HEIGHT, MIN_COL_WIDTH, MAX_COL_WIDTH };
