import { fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CanvasRenderer, COL_HEADER_HEIGHT, ROW_HEIGHT } from '../../src/renderer/CanvasRenderer';
import { Store } from '../../src/store/Store';

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

function installCtx(): void {
  const ctx: Partial<CanvasRenderingContext2D> = {
    beginPath: vi.fn(), clip: vi.fn(), fillRect: vi.fn(), fillText: vi.fn(),
    lineTo: vi.fn(), measureText: vi.fn(() => ({ width: 24 } as TextMetrics)),
    moveTo: vi.fn(), rect: vi.fn(), restore: vi.fn(), save: vi.fn(),
    scale: vi.fn(), setTransform: vi.fn(), stroke: vi.fn(), strokeRect: vi.fn(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as CanvasRenderingContext2D);
}

function installRaf(): FrameRequestCallback[] {
  const cbs: FrameRequestCallback[] = [];
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cbs.push(cb); return cbs.length; });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
  return cbs;
}

describe('RowResize', () => {
  afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });

  it('detects row border on mousedown and starts resize', () => {
    installCtx(); installRaf();
    const onRowResize = vi.fn();
    const canvas = makeCanvas();
    const renderer = new CanvasRenderer({ canvas, store: new Store(), onRowResize });

    // Row 0 bottom border at y = COL_HEADER_HEIGHT + ROW_HEIGHT = 50 (canvas coords)
    // Client coords: clientY = rect.top + 50 = 20 + 50 = 70
    // Mouse in row header area: clientX < rect.left + ROW_HEADER_WIDTH = 10 + 46 = 56
    const borderY = 20 + COL_HEADER_HEIGHT + ROW_HEIGHT;
    fireEvent.mouseDown(canvas, { clientX: 10 + 5, clientY: borderY });
    // Drag down 30px
    fireEvent.mouseMove(window, { clientX: 10 + 5, clientY: borderY + 30 });
    // Release
    fireEvent.mouseUp(window);

    expect(onRowResize).toHaveBeenCalledWith(0, expect.any(Number));
    const h = onRowResize.mock.calls[0]?.[1] as number;
    expect(h).toBeGreaterThanOrEqual(15);
    expect(h).toBeLessThanOrEqual(500);
    renderer.destroy();
  });

  it('double-click on row border resets or auto-fits height', () => {
    installCtx(); installRaf();
    const onRowDblClick = vi.fn();
    const canvas = makeCanvas();
    const renderer = new CanvasRenderer({ canvas, store: new Store(), onRowDblClick });

    // Double-click on row 0 bottom border
    const borderY = 20 + COL_HEADER_HEIGHT + ROW_HEIGHT;
    fireEvent.dblClick(canvas, { clientX: 10 + 5, clientY: borderY });

    expect(onRowDblClick).toHaveBeenCalledWith(0);
    renderer.destroy();
  });

  it('onRowResize command updates store', () => {
    installCtx(); installRaf();
    const store = new Store();
    const onRowResize = vi.fn((r: number, height: number) => {
      store.setRow(r, { height });
    });
    const canvas = makeCanvas();
    const renderer = new CanvasRenderer({ canvas, store, onRowResize });

    const borderY = 20 + COL_HEADER_HEIGHT + ROW_HEIGHT;
    fireEvent.mouseDown(canvas, { clientX: 10 + 5, clientY: borderY });
    fireEvent.mouseMove(window, { clientX: 10 + 5, clientY: borderY + 20 });
    fireEvent.mouseUp(window);

    expect(onRowResize).toHaveBeenCalled();
    expect(store.getRow(0)?.height).toBeDefined();
    renderer.destroy();
  });
});
