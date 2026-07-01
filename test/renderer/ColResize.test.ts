import { fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CanvasRenderer, ROW_HEADER_WIDTH, COL_WIDTH } from '../../src/renderer/CanvasRenderer';
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

describe('ColResize', () => {
  afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });

  it('detects column border on mousedown and starts resize', () => {
    installCtx(); installRaf();
    const onColResize = vi.fn();
    const canvas = makeCanvas();
    const renderer = new CanvasRenderer({ canvas, store: new Store(), onColResize });

    // Column 0 right border at x = ROW_HEADER_WIDTH + COL_WIDTH = 146 (canvas coords)
    // Client coords: clientX = rect.left + 146 = 10 + 146 = 156
    // Mouse in col header area: clientY < rect.top + COL_HEADER_HEIGHT = 20 + 25 = 45
    const borderX = 10 + ROW_HEADER_WIDTH + COL_WIDTH;
    fireEvent.mouseDown(canvas, { clientX: borderX, clientY: 20 + 5 });
    // Drag right 40px
    fireEvent.mouseMove(window, { clientX: borderX + 40, clientY: 20 + 5 });
    // Release
    fireEvent.mouseUp(window);

    expect(onColResize).toHaveBeenCalledWith(0, expect.any(Number));
    const w = onColResize.mock.calls[0]?.[1] as number;
    expect(w).toBeGreaterThanOrEqual(30);
    expect(w).toBeLessThanOrEqual(500);
    renderer.destroy();
  });

  it('double-click on column border resets or auto-fits width', () => {
    installCtx(); installRaf();
    const onColDblClick = vi.fn();
    const canvas = makeCanvas();
    const renderer = new CanvasRenderer({ canvas, store: new Store(), onColDblClick });

    // Double-click on column 0 right border
    const borderX = 10 + ROW_HEADER_WIDTH + COL_WIDTH;
    fireEvent.dblClick(canvas, { clientX: borderX, clientY: 20 + 5 });

    expect(onColDblClick).toHaveBeenCalledWith(0);
    renderer.destroy();
  });

  it('onColResize command updates store', () => {
    installCtx(); installRaf();
    const store = new Store();
    const onColResize = vi.fn((c: number, width: number) => {
      store.setCol(c, { width });
    });
    const canvas = makeCanvas();
    const renderer = new CanvasRenderer({ canvas, store, onColResize });

    const borderX = 10 + ROW_HEADER_WIDTH + COL_WIDTH;
    fireEvent.mouseDown(canvas, { clientX: borderX, clientY: 20 + 5 });
    fireEvent.mouseMove(window, { clientX: borderX + 40, clientY: 20 + 5 });
    fireEvent.mouseUp(window);

    expect(onColResize).toHaveBeenCalled();
    expect(store.getCol(0)?.width).toBeDefined();
    renderer.destroy();
  });
});
