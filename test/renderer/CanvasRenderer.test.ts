import { fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CanvasRenderer, canvasPointToCell, canvasPointToHeader } from '../../src/renderer/CanvasRenderer';
import { Store } from '../../src/store/Store';

function makeCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'clientWidth', { configurable: true, value: 300 });
  Object.defineProperty(canvas, 'clientHeight', { configurable: true, value: 150 });
  Object.defineProperty(canvas, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ left: 10, top: 20, width: 300, height: 150, right: 310, bottom: 170, x: 10, y: 20, toJSON: () => ({}) }),
  });
  document.body.append(canvas);
  return canvas;
}

function installCanvasContext(): Partial<CanvasRenderingContext2D> {
  const ctx: Partial<CanvasRenderingContext2D> = {
    beginPath: vi.fn(),
    clip: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    lineTo: vi.fn(),
    measureText: vi.fn(() => ({ width: 24 } as TextMetrics)),
    moveTo: vi.fn(),
    rect: vi.fn(),
    restore: vi.fn(),
    save: vi.fn(),
    scale: vi.fn(),
    setTransform: vi.fn(),
    stroke: vi.fn(),
    strokeRect: vi.fn(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as CanvasRenderingContext2D);
  return ctx;
}

describe('CanvasRenderer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('instantiates and destroys', () => {
    installCanvasContext();
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
    const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);

    const renderer = new CanvasRenderer({ canvas: makeCanvas(), store: new Store() });
    renderer.destroy();

    expect(raf).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledWith(1);
  });

  it('renders after store subscription without throwing', () => {
    installCanvasContext();
    const callbacks = installAnimationFrames();
    const store = new Store();
    const renderer = new CanvasRenderer({ canvas: makeCanvas(), store });

    callbacks[0]?.(0);
    store.setCell(0, 0, { text: 'A1' });

    expect(() => callbacks[1]?.(16)).not.toThrow();
    renderer.destroy();
  });

  it('converts canvas coordinates to cell addresses', () => {
    const canvas = makeCanvas();

    expect(canvasPointToCell(canvas, 10 + 46 + 5, 20 + 25 + 5)).toEqual({ r: 0, c: 0 });
    expect(canvasPointToCell(canvas, 10 + 46 + 205, 20 + 25 + 55)).toEqual({ r: 2, c: 2 });
  });

  it('converts zoomed canvas coordinates to cell addresses', () => {
    const canvas = makeCanvas();

    expect(canvasPointToCell(canvas, 10 + 46 + 205, 20 + 25 + 55, 0, 0, 200)).toEqual({ r: 1, c: 1 });
  });

  it('ignores row and column headers during coordinate conversion', () => {
    const canvas = makeCanvas();

    expect(canvasPointToCell(canvas, 40, 50)).toBeNull();
    expect(canvasPointToCell(canvas, 80, 30)).toBeNull();
  });

  it('converts zoomed header coordinates to column addresses', () => {
    const canvas = makeCanvas();

    expect(canvasPointToHeader(canvas, 10 + 46 + 205, 20 + 5, 0, 0, 200)).toEqual({ type: 'column', c: 1 });
  });

  it('emits mousedown cell clicks with converted coordinates', () => {
    installCanvasContext();
    const callbacks = installAnimationFrames();
    const onCellClick = vi.fn();
    const renderer = new CanvasRenderer({ canvas: makeCanvas(), store: new Store(), onCellClick });

    fireEvent.mouseDown(document.querySelector('canvas') as HTMLCanvasElement, { clientX: 10 + 46 + 130, clientY: 20 + 25 + 30 });

    expect(onCellClick).toHaveBeenCalledWith({ r: 1, c: 1 });
    expect(callbacks.length).toBe(1);
    renderer.destroy();
  });

  it('extends column selection while dragging column headers', () => {
    installCanvasContext();
    installAnimationFrames();
    const onColumnSelect = vi.fn();
    const canvas = makeCanvas();
    const renderer = new CanvasRenderer({ canvas, store: new Store(), onColumnSelect });

    fireEvent.mouseDown(canvas, { clientX: 10 + 46 + 5, clientY: 20 + 5 });
    fireEvent.mouseMove(window, { clientX: 10 + 46 + 205, clientY: 20 + 5 });

    expect(onColumnSelect).toHaveBeenNthCalledWith(1, 0, false);
    expect(onColumnSelect).toHaveBeenNthCalledWith(2, 2, true);
    renderer.destroy();
  });

  it('extends row selection while dragging row headers', () => {
    installCanvasContext();
    installAnimationFrames();
    const onRowSelect = vi.fn();
    const canvas = makeCanvas();
    const renderer = new CanvasRenderer({ canvas, store: new Store(), onRowSelect });

    fireEvent.mouseDown(canvas, { clientX: 10 + 5, clientY: 20 + 25 + 5 });
    fireEvent.mouseMove(window, { clientX: 10 + 5, clientY: 20 + 25 + 55 });

    expect(onRowSelect).toHaveBeenNthCalledWith(1, 0, false);
    expect(onRowSelect).toHaveBeenNthCalledWith(2, 2, true);
    renderer.destroy();
  });

  it('theme change event schedules invalidation and repaint', () => {
    installCanvasContext();
    const callbacks = installAnimationFrames();
    const renderer = new CanvasRenderer({ canvas: makeCanvas(), store: new Store() });
    callbacks[0]?.(0);

    window.dispatchEvent(new CustomEvent('ss:theme-changed'));

    expect(callbacks[1]).toBeDefined();
    renderer.destroy();
  });

  it('reads CSS variables for each paint', () => {
    const ctx = installCanvasContext();
    const callbacks = installAnimationFrames();
    document.documentElement.style.setProperty('--ss-bg', '#101010');
    const renderer = new CanvasRenderer({ canvas: makeCanvas(), store: new Store() });

    callbacks[0]?.(0);

    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 300, 150);
    expect(ctx.fillStyle).toBe('#333');
    document.documentElement.style.removeProperty('--ss-bg');
    renderer.destroy();
  });

  it('renders formulas when showFormula is enabled', () => {
    const ctx = installCanvasContext();
    const callbacks = installAnimationFrames();
    const store = new Store();
    store.setCell(0, 0, { text: '3', formula: '=SUM(1,2)' });
    const renderer = new CanvasRenderer({ canvas: makeCanvas(), store, showFormula: true });

    callbacks[0]?.(0);

    expect(ctx.fillText).toHaveBeenCalledWith('=SUM(1,2)', expect.any(Number), expect.any(Number));
    renderer.destroy();
  });
});

function installAnimationFrames(): FrameRequestCallback[] {
  const callbacks: FrameRequestCallback[] = [];
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    callbacks.push(callback);
    return callbacks.length;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
  return callbacks;
}
