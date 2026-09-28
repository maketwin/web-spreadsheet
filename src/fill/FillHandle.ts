import { COL_HEADER_HEIGHT, ROW_HEADER_WIDTH, TOTAL_COLS, TOTAL_ROWS, type CellAddress } from '../renderer/CanvasRenderer';
import type { VirtualScroller } from '../renderer/VirtualScroller';
import type { RangeAddress } from '../selection/Range';

export interface FillHandleOptions {
  canvas: HTMLCanvasElement;
  scroller: VirtualScroller;
  selectedRange: () => RangeAddress | undefined;
  onFill?: ((source: RangeAddress, target: RangeAddress, ctrlKey: boolean) => void) | undefined;
  invalidate: () => void;
  /** Freeze-aware geometry from the owning renderer (fallback: scroll-only math). */
  cellVP?: (r: number, c: number) => { x: number; y: number };
  cellAtPoint?: (clientX: number, clientY: number) => { r: number; c: number } | null;
}

const HANDLE_SIZE = 7;

export class FillHandle {
  private dragging = false;
  private fillTarget: RangeAddress | undefined;
  private ctrlKey = false;

  public constructor(private readonly opts: FillHandleOptions) {}

  /** `touchTolerance` widens the handle's hit square for fat-finger presses
   * (the pointer path passes the renderer's touch slop; mouse keeps 0). */
  public onMouseDown(event: MouseEvent, touchTolerance = 0): boolean {
    if (!this.isOverHandle(event.clientX, event.clientY, touchTolerance)) return false;
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
    // Excel tracks the toggle for the whole gesture, not just the press.
    this.ctrlKey = event.ctrlKey || event.metaKey;
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

  /** True when the point is over the handle square (renderer routes double-click fills). */
  public isHandleAt(clientX: number, clientY: number): boolean { return this.isOverHandle(clientX, clientY); }

  public destroy(): void { this.dragging = false; this.fillTarget = undefined; }

  private isOverHandle(clientX: number, clientY: number, tolerance = 0): boolean {
    const range = this.opts.selectedRange();
    if (range === undefined) return false;
    const rect = this.opts.canvas.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    // Handle sits at the range's bottom-right corner (freeze-aware when provided).
    const pos = this.opts.cellVP !== undefined
      ? this.opts.cellVP(range.r2, range.c2)
      : this.scrollerCellVP(range.r2, range.c2);
    const hx = pos.x + this.opts.scroller.getColWidth(range.c2);
    const hy = pos.y + this.opts.scroller.getRowHeight(range.r2);
    const reach = HANDLE_SIZE + tolerance;
    return Math.abs(mx - hx) <= reach && Math.abs(my - hy) <= reach;
  }

  private clientToCell(clientX: number, clientY: number): { r: number; c: number } | null {
    if (this.opts.cellAtPoint !== undefined) return this.opts.cellAtPoint(clientX, clientY);
    const rect = this.opts.canvas.getBoundingClientRect();
    const gx = clientX - rect.left - ROW_HEADER_WIDTH + this.opts.scroller.scrollLeft;
    const gy = clientY - rect.top - COL_HEADER_HEIGHT + this.opts.scroller.scrollTop;
    if (gx < 0 || gy < 0) return null;
    const r = gy >= this.opts.scroller.totalHeight() ? TOTAL_ROWS - 1 : this.opts.scroller.rowAtPixel(gy);
    const c = gx >= this.opts.scroller.totalWidth() ? TOTAL_COLS - 1 : this.opts.scroller.colAtPixel(gx);
    return { r, c };
  }

  /** Scroll-only viewport position (legacy fallback when the renderer is absent). */
  private scrollerCellVP(r: number, c: number): { x: number; y: number } {
    const pos = this.opts.scroller.cellToPixel(r, c);
    return { x: ROW_HEADER_WIDTH + pos.x - this.opts.scroller.scrollLeft, y: COL_HEADER_HEIGHT + pos.y - this.opts.scroller.scrollTop };
  }
}

function computeFillTarget(source: RangeAddress, r: number, c: number): RangeAddress {
  // Axis = how far the pointer moved beyond each edge of the source (0 while
  // inside), so a horizontal drag across a tall selection stays horizontal.
  const dR = r < source.r1 ? source.r1 - r : r > source.r2 ? r - source.r2 : 0;
  const dC = c < source.c1 ? source.c1 - c : c > source.c2 ? c - source.c2 : 0;
  if (dR <= 0 && dC <= 0) return { ...source };
  if (dR >= dC) {
    return {
      r1: Math.min(source.r1, r),
      c1: source.c1,
      r2: Math.max(source.r2, r),
      c2: source.c2,
    };
  }
  return {
    r1: source.r1,
    c1: Math.min(source.c1, c),
    r2: source.r2,
    c2: Math.max(source.c2, c),
  };
}

function normalizeFillTarget(source: RangeAddress, target: RangeAddress): RangeAddress {
  return {
    r1: Math.min(source.r1, target.r1),
    c1: Math.min(source.c1, target.c1),
    r2: Math.max(source.r2, target.r2),
    c2: Math.max(source.c2, target.c2),
  };
}

/** Excel: after a fill the selection lands on the fill result (source ∪ target).
 * The active cell stays in the source; the Shift+Arrow pivot (anchor) moves to
 * the far edge the fill extended to. Undefined when the fill was a no-op
 * (target equals the source) — then the selection is left untouched. */
export function selectionAfterFill(source: RangeAddress, target: RangeAddress, active: CellAddress | undefined): { readonly range: RangeAddress; readonly active: CellAddress; readonly anchor: CellAddress } | undefined {
  const range = {
    r1: Math.min(source.r1, target.r1),
    c1: Math.min(source.c1, target.c1),
    r2: Math.max(source.r2, target.r2),
    c2: Math.max(source.c2, target.c2),
  };
  if (range.r1 === source.r1 && range.r2 === source.r2 && range.c1 === source.c1 && range.c2 === source.c2) return undefined;
  const act = active ?? { r: source.r1, c: source.c1 };
  const anchor = {
    r: target.r2 > source.r2 ? range.r2 : target.r1 < source.r1 ? range.r1 : act.r,
    c: target.c2 > source.c2 ? range.c2 : target.c1 < source.c1 ? range.c1 : act.c,
  };
  return { range, active: act, anchor };
}
