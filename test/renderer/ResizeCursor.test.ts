import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResizeHandler } from '../../src/renderer/ResizeHandler';
import { VirtualScroller } from '../../src/renderer/VirtualScroller';
import { Store } from '../../src/store/Store';
import { ROW_HEADER_WIDTH, COL_HEADER_HEIGHT, ROW_HEIGHT, COL_WIDTH } from '../../src/renderer/coordinate';

function makeCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'clientWidth', { configurable: true, value: 400 });
  Object.defineProperty(canvas, 'clientHeight', { configurable: true, value: 300 });
  Object.defineProperty(canvas, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ left: 10, top: 20, width: 400, height: 300, right: 410, bottom: 320, x: 10, y: 20, toJSON: () => ({}) }),
  });
  document.body.append(canvas);
  return canvas;
}

function makeScroller(): VirtualScroller {
  return new VirtualScroller({
    totalRows: 1000, totalCols: 26,
    defaultRowHeight: ROW_HEIGHT, defaultColWidth: COL_WIDTH,
    viewportW: 354, viewportH: 275,
  });
}

describe('ResizeCursor', () => {
  afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });

  it('sets ew-resize cursor when hovering column border', () => {
    const canvas = makeCanvas();
    const scroller = makeScroller();
    const handler = new ResizeHandler({
      canvas, scroller, store: new Store(),
      zoom: () => 1, invalidate: () => {},
    });

    // Column 0 right border at canvas x = ROW_HEADER_WIDTH + COL_WIDTH = 146
    // clientX = rect.left + 146 = 156; clientY in header area: < rect.top + COL_HEADER_HEIGHT = 45
    const ev = new MouseEvent('mousemove', { clientX: 10 + ROW_HEADER_WIDTH + COL_WIDTH, clientY: 20 + 5 });
    handler.onMouseMove(ev);

    expect(canvas.style.cursor).toBe('ew-resize');
    handler.destroy();
  });

  it('sets ns-resize cursor when hovering row border', () => {
    const canvas = makeCanvas();
    const scroller = makeScroller();
    const handler = new ResizeHandler({
      canvas, scroller, store: new Store(),
      zoom: () => 1, invalidate: () => {},
    });

    // Row 0 bottom border at canvas y = COL_HEADER_HEIGHT + ROW_HEIGHT = 50
    // clientY = rect.top + 50 = 70; clientX in row header area: < rect.left + ROW_HEADER_WIDTH = 56
    const ev = new MouseEvent('mousemove', { clientX: 10 + 5, clientY: 20 + COL_HEADER_HEIGHT + ROW_HEIGHT });
    handler.onMouseMove(ev);

    expect(canvas.style.cursor).toBe('ns-resize');
    handler.destroy();
  });

  it('mousedown on column border starts resize and fires callback on mouseup', () => {
    const onColResize = vi.fn();
    const canvas = makeCanvas();
    const scroller = makeScroller();
    const handler = new ResizeHandler({
      canvas, scroller, store: new Store(),
      zoom: () => 1, invalidate: () => {}, onColResize,
    });

    const borderX = 10 + ROW_HEADER_WIDTH + COL_WIDTH;
    const downEv = new MouseEvent('mousedown', { clientX: borderX, clientY: 20 + 5 });
    handler.onMouseDown(downEv);

    const moveEv = new MouseEvent('mousemove', { clientX: borderX + 40, clientY: 20 + 5 });
    handler.onMouseMove(moveEv);

    handler.onMouseUp();

    expect(onColResize).toHaveBeenCalledWith(0, expect.any(Number));
    handler.destroy();
  });
});
