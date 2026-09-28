import { fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CanvasRenderer, COL_WIDTH, COL_HEADER_HEIGHT, ROW_HEADER_WIDTH } from '../../src/renderer/CanvasRenderer';
import { ROW_HEIGHT } from '../../src/renderer/coordinate';
import { Store } from '../../src/store/Store';

function makeCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'clientWidth', { configurable: true, value: 800 });
  Object.defineProperty(canvas, 'clientHeight', { configurable: true, value: 600 });
  Object.defineProperty(canvas, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ left: 10, top: 20, width: 800, height: 600, right: 810, bottom: 620, x: 10, y: 20, toJSON: () => ({}) }),
  });
  document.body.append(canvas);
  return canvas;
}

function installCtx(): void {
  const ctx: Partial<CanvasRenderingContext2D> = {
    beginPath: vi.fn(), clip: vi.fn(), fillRect: vi.fn(), fillText: vi.fn(),
    lineTo: vi.fn(), measureText: vi.fn(() => ({ width: 24 } as TextMetrics)),
    moveTo: vi.fn(), rect: vi.fn(), restore: vi.fn(), save: vi.fn(),
    scale: vi.fn(), setTransform: vi.fn(), stroke: vi.fn(), strokeRect: vi.fn(), clearRect: vi.fn(),
    setLineDash: vi.fn(), drawImage: vi.fn(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as CanvasRenderingContext2D);
}

function installRaf(): void {
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
}

/** A real fill-handle drag through the renderer: mouse down on the handle of
 * A1, drag down two rows, release. Excel then selects the fill result A1:A3
 * with the active cell still A1 and the pivot on A3. */
describe('CanvasRenderer fill-drag selection', () => {
  afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });

  it('after a fill drag the selection lands on the fill result area', () => {
    installCtx(); installRaf();
    const store = new Store();
    store.setCell(0, 0, { text: '1' });
    const onFill = vi.fn();
    const onSelectionChange = vi.fn();
    const canvas = makeCanvas();
    const renderer = new CanvasRenderer({ canvas, store, onFill, onSelectionChange });
    renderer.setSelection({ r1: 0, c1: 0, r2: 0, c2: 0 }, 'range', { r: 0, c: 0 });

    // Handle square sits just past the bottom-right corner of the selection.
    const hx = 10 + ROW_HEADER_WIDTH + 1 * COL_WIDTH;
    const hy = 20 + COL_HEADER_HEIGHT + 1 * ROW_HEIGHT;
    fireEvent.mouseDown(canvas, { clientX: hx, clientY: hy });
    // Drag to a point inside cell (2, 0): 10px in from the cell's top-left.
    fireEvent.mouseMove(window, { clientX: 10 + ROW_HEADER_WIDTH + 10, clientY: hy + ROW_HEIGHT + 10 });
    fireEvent.mouseUp(window);

    expect(onFill).toHaveBeenCalledTimes(1);
    const [, target] = onFill.mock.calls[0] as [{ r1: number; c1: number; r2: number; c2: number }, { r1: number; c1: number; r2: number; c2: number }, boolean];
    expect(target).toEqual({ r1: 0, c1: 0, r2: 2, c2: 0 });
    // Excel: the selection (and the reported change) covers source ∪ target,
    // the active cell stays on the source, the pivot is the far edge.
    expect(onSelectionChange).toHaveBeenLastCalledWith({ r1: 0, c1: 0, r2: 2, c2: 0 }, { r: 0, c: 0 }, { r: 2, c: 0 });
    renderer.destroy();
  });
});
