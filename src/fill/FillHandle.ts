import { COL_HEADER_HEIGHT, ROW_HEADER_WIDTH } from '../renderer/CanvasRenderer';
import type { VirtualScroller } from '../renderer/VirtualScroller';
import type { RangeAddress } from '../selection/Range';

export interface FillHandleOptions {
  canvas: HTMLCanvasElement;
  scroller: VirtualScroller;
  selectedRange: () => RangeAddress | undefined;
  onFill?: ((source: RangeAddress, target: RangeAddress, ctrlKey: boolean) => void) | undefined;
  invalidate: () => void;
}

const HANDLE_SIZE = 7;

export class FillHandle {
  private dragging = false;
  private fillTarget: RangeAddress | undefined;
  private ctrlKey = false;

  public constructor(private readonly opts: FillHandleOptions) {}

  public onMouseDown(event: MouseEvent): boolean {
    if (!this.isOverHandle(event.clientX, event.clientY)) return false;
    this.dragging = true;
    this.ctrlKey = event.ctrlKey || event.metaKey;
    this.opts.canvas.focus();
    return true;
  }

  public onMouseMove(event: MouseEvent): void {
    if (!this.dragging) {
      this.opts.canvas.style.cursor = this.isOverHandle(event.clientX, event.clientY) ? 'crosshair' : '';
      return;
    }
    const range = this.opts.selectedRange();
    if (range === undefined) return;
    const cell = this.clientToCell(event.clientX, event.clientY);
    if (cell === null) return;
    this.fillTarget = computeFillTarget(range, cell.r, cell.c);
    this.opts.invalidate();
  }

  public onMouseUp(): void {
    if (!this.dragging) return;
    const source = this.opts.selectedRange();
    if (source !== undefined && this.fillTarget !== undefined) {
      const normalized = normalizeFillTarget(source, this.fillTarget);
      this.opts.onFill?.(source, normalized, this.ctrlKey);
    }
    this.dragging = false;
    this.fillTarget = undefined;
    this.opts.invalidate();
  }

  public isDragging(): boolean { return this.dragging; }

  public getFillTarget(): RangeAddress | undefined { return this.fillTarget; }

  public destroy(): void { this.dragging = false; this.fillTarget = undefined; }

  private isOverHandle(clientX: number, clientY: number): boolean {
    const range = this.opts.selectedRange();
    if (range === undefined) return false;
    const rect = this.opts.canvas.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    const pos = this.opts.scroller.cellToPixel(range.r2, range.c2);
    const hx = ROW_HEADER_WIDTH + pos.x + this.opts.scroller.getColWidth(range.c2) - this.opts.scroller.scrollLeft;
    const hy = COL_HEADER_HEIGHT + pos.y + this.opts.scroller.getRowHeight(range.r2) - this.opts.scroller.scrollTop;
    return Math.abs(mx - hx) <= HANDLE_SIZE && Math.abs(my - hy) <= HANDLE_SIZE;
  }

  private clientToCell(clientX: number, clientY: number): { r: number; c: number } | null {
    const rect = this.opts.canvas.getBoundingClientRect();
    const gx = clientX - rect.left - ROW_HEADER_WIDTH + this.opts.scroller.scrollLeft;
    const gy = clientY - rect.top - COL_HEADER_HEIGHT + this.opts.scroller.scrollTop;
    if (gx < 0 || gy < 0) return null;
    let r = 0, y = 0;
    while (r < 1000 && y + this.opts.scroller.getRowHeight(r) <= gy) { y += this.opts.scroller.getRowHeight(r); r += 1; }
    let c = 0, x = 0;
    while (c < 26 && x + this.opts.scroller.getColWidth(c) <= gx) { x += this.opts.scroller.getColWidth(c); c += 1; }
    if (r >= 1000 || c >= 26) return null;
    return { r, c };
  }
}

function computeFillTarget(source: RangeAddress, r: number, c: number): RangeAddress {
  const isVertical = Math.abs(r - source.r2) >= Math.abs(c - source.c2);
  if (isVertical) {
    const r2 = r < source.r1 ? source.r1 : Math.max(r, source.r2);
    return { r1: source.r1, c1: source.c1, r2, c2: source.c2 };
  }
  const c2 = c < source.c1 ? source.c1 : Math.max(c, source.c2);
  return { r1: source.r1, c1: source.c1, r2: source.r2, c2 };
}

function normalizeFillTarget(source: RangeAddress, target: RangeAddress): RangeAddress {
  return {
    r1: Math.min(source.r1, target.r1),
    c1: Math.min(source.c1, target.c1),
    r2: Math.max(source.r2, target.r2),
    c2: Math.max(source.c2, target.c2),
  };
}
