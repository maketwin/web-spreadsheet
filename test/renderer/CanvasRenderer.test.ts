import { afterEach, describe, expect, it, vi } from 'vitest';
import { CanvasRenderer } from '../../src/renderer/CanvasRenderer';
import { Store } from '../../src/store/Store';

function makeCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'clientWidth', { configurable: true, value: 300 });
  Object.defineProperty(canvas, 'clientHeight', { configurable: true, value: 150 });
  return canvas;
}

function installCanvasContext(): void {
  const ctx: Partial<CanvasRenderingContext2D> = {
    beginPath: vi.fn(),
    clip: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    rect: vi.fn(),
    restore: vi.fn(),
    save: vi.fn(),
    scale: vi.fn(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    // Vitest jsdom has no real canvas context; this mock implements the methods used by CanvasRenderer.
    ctx as CanvasRenderingContext2D,
  );
}

describe('CanvasRenderer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
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
    const callbacks: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    const store = new Store();
    const renderer = new CanvasRenderer({ canvas: makeCanvas(), store });

    const initial = callbacks[0];
    expect(initial).toBeDefined();
    initial?.(0);
    store.setCell(0, 0, { text: 'A1' });
    const next = callbacks[1];
    expect(next).toBeDefined();
    expect(() => next?.(16)).not.toThrow();

    renderer.destroy();
  });
});
