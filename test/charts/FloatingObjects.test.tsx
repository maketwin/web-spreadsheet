import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FloatingChart, applyGesture, commitAnchor, type Gesture, type Rect } from '../../src/charts/FloatingChart';
import { FloatingImage } from '../../src/charts/FloatingImage';
import type { ChartSpec, ImageSpec } from '../../src/charts/types';
import type { CanvasRenderer } from '../../src/renderer/CanvasRenderer';
import { COL_HEADER_HEIGHT, ROW_HEADER_WIDTH } from '../../src/renderer/coordinate';
import { Store } from '../../src/store/Store';

vi.mock('chart.js', () => {
  class FakeChart {
    static register(): void {}
    constructor(public canvas: HTMLCanvasElement, public config: unknown) {}
    destroy(): void {}
  }
  return { Chart: FakeChart, registerables: [] };
});

/**
 * Floating objects (charts/images) are Excel-style canvas overlays: select,
 * drag, resize, nudge, delete, undo. The renderer is the geometry source of
 * truth, so the tests drive a fake renderer with deterministic pixel math.
 */
function makeRenderer(): CanvasRenderer {
  return {
    chartRect: (anchor) => ({
      x: ROW_HEADER_WIDTH + anchor.from.c * 70 + anchor.from.offX,
      y: COL_HEADER_HEIGHT + anchor.from.r * 20 + anchor.from.offY,
      w: 140,
      h: 60,
    }),
    gridClientRect: () => ({ x: ROW_HEADER_WIDTH, y: COL_HEADER_HEIGHT, w: 800, h: 400 }),
    anchorFromRect: (rect) => ({
      from: { r: Math.round((rect.y - COL_HEADER_HEIGHT) / 20), c: Math.round((rect.x - ROW_HEADER_WIDTH) / 70), offX: 0, offY: 0 },
      to: { r: Math.round((rect.y - COL_HEADER_HEIGHT + rect.h) / 20), c: Math.round((rect.x - ROW_HEADER_WIDTH + rect.w) / 70), offX: 0, offY: 0 },
    }),
    defaultCellWidth: () => 70,
    defaultCellHeight: () => 20,
  } as unknown as CanvasRenderer;
}

const chartSpec: ChartSpec = {
  id: 'chart-1',
  type: 'bar',
  range: '0,0:2,2',
  title: '销售',
  anchor: {
    from: { r: 5, c: 5, offX: 0, offY: 0 },
    to: { r: 7, c: 7, offX: 0, offY: 0 },
  },
};

const imageSpec: ImageSpec = {
  id: 'img-1',
  name: 'logo.png',
  src: 'data:image/png;base64,iVBORw0KGgo=',
  anchor: chartSpec.anchor,
};

/**
 * jsdom has no PointerEvent, so fireEvent.pointerDown produces an event whose
 * `button` is undefined and the components' primary-button guard rejects it.
 * Dispatch MouseEvent-based pointer events instead — same shape the browser
 * delivers for a left-button pointer press. Each dispatch is wrapped in act()
 * so React flushes the gesture's live-rect state between events (a real
 * browser renders between pointer events; a synchronous dispatch sequence
 * would leave the gesture reading stale rects).
 */
function pointerDown(el: Element, clientX = 100, clientY = 100): void {
  act(() => { el.dispatchEvent(new MouseEvent('pointerdown', { button: 0, bubbles: true, cancelable: true, clientX, clientY })); });
}
function pointerMove(clientX: number, clientY: number): void {
  act(() => { window.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX, clientY })); });
}
function pointerUp(): void {
  act(() => { window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true })); });
}

describe('FloatingChart', () => {
  let renderer: CanvasRenderer;
  let store: Store;

  beforeEach(() => {
    renderer = makeRenderer();
    store = new Store();
    store.setCell(0, 0, { text: 'Q1' });
    store.setCell(1, 0, { text: '10', value: 10 });
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('positions itself from the renderer geometry and exposes the title', () => {
    render(<FloatingChart spec={chartSpec} store={store} renderer={renderer} selected={false} onSelect={() => {}} onGeometry={() => {}} onRemove={() => {}} />);
    const el = screen.getByRole('img', { name: '销售' });
    // chartRect returns viewport coords (incl. header strips); the element is
    // positioned relative to the canvas wrap, so the headers are subtracted.
    expect(el.style.left).toBe(`${5 * 70}px`);
    expect(el.style.top).toBe(`${5 * 20}px`);
    expect(el.style.width).toBe('140px');
  });

  it('hides when no renderer is available', () => {
    const { container } = render(<FloatingChart spec={chartSpec} store={store} renderer={null} selected={false} onSelect={() => {}} onGeometry={() => {}} onRemove={() => {}} />);
    const el = container.querySelector<HTMLElement>('.ss-chart-object');
    expect(el).not.toBeNull();
    expect(el!.style.visibility).toBe('hidden');
  });

  it('pointer-down selects and arms a drag; moving commits the new anchor', () => {
    const onSelect = vi.fn();
    const onGeometry = vi.fn();
    render(<FloatingChart spec={chartSpec} store={store} renderer={renderer} selected={false} onSelect={onSelect} onGeometry={onGeometry} onRemove={() => {}} />);
    const el = screen.getByRole('img', { name: '销售' });

    pointerDown(el);
    expect(onSelect).toHaveBeenCalledWith('chart-1');
    pointerMove(160, 140); // +60px right, +40px down
    pointerUp();

    expect(onGeometry).toHaveBeenCalledTimes(1);
    const [, anchor] = onGeometry.mock.calls[0]!;
    // +60px ≈ +1 col (70px rounds to 1), +40px = +2 rows (20px each)
    expect(anchor.from.c).toBe(6);
    expect(anchor.from.r).toBe(7);
  });

  it('Delete removes, Escape deselects, arrows nudge by one cell', () => {
    const onRemove = vi.fn();
    const onSelect = vi.fn();
    const onGeometry = vi.fn();
    render(<FloatingChart spec={chartSpec} store={store} renderer={renderer} selected onRemove={onRemove} onSelect={onSelect} onGeometry={onGeometry} />);
    const el = screen.getByRole('img', { name: '销售' });
    el.focus();

    fireEvent.keyDown(el, { key: 'Delete' });
    expect(onRemove).toHaveBeenCalledWith('chart-1');

    fireEvent.keyDown(el, { key: 'Escape' });
    expect(onSelect).toHaveBeenCalledWith(null);

    onGeometry.mockClear();
    // Plain arrow nudges 1px; Ctrl+arrow moves one default cell (Excel-style).
    fireEvent.keyDown(el, { key: 'ArrowRight', ctrlKey: true });
    const [, right] = onGeometry.mock.calls[0]!;
    expect(right.from.c).toBe(6); // one default cell (70px)

    onGeometry.mockClear();
    fireEvent.keyDown(el, { key: 'ArrowDown', shiftKey: true });
    const [, down] = onGeometry.mock.calls[0]!;
    // Shift+Arrow = 10px = half a 20px row; the anchor snap rounds 5.5 up.
    expect(down.from.r).toBe(6);
  });

  it('Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y wire undo and redo', () => {
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    render(<FloatingChart spec={chartSpec} store={store} renderer={renderer} selected onUndo={onUndo} onRedo={onRedo} onSelect={() => {}} onGeometry={() => {}} onRemove={() => {}} />);
    const el = screen.getByRole('img', { name: '销售' });

    fireEvent.keyDown(el, { key: 'z', ctrlKey: true });
    expect(onUndo).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(el, { key: 'z', ctrlKey: true, shiftKey: true });
    expect(onRedo).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(el, { key: 'y', ctrlKey: true });
    expect(onRedo).toHaveBeenCalledTimes(2);
  });

  it('shows the 8 resize handles only while selected', () => {
    const { rerender } = render(<FloatingChart spec={chartSpec} store={store} renderer={renderer} selected={false} onSelect={() => {}} onGeometry={() => {}} onRemove={() => {}} />);
    expect(document.querySelectorAll('[data-handle]')).toHaveLength(0);
    rerender(<FloatingChart spec={chartSpec} store={store} renderer={renderer} selected onSelect={() => {}} onGeometry={() => {}} onRemove={() => {}} />);
    expect(document.querySelectorAll('[data-handle]')).toHaveLength(8);
  });
});

describe('FloatingImage', () => {
  beforeEach(() => {
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('renders the image and responds to Delete/Escape/arrows like a chart', () => {
    const onRemove = vi.fn();
    const onSelect = vi.fn();
    const onGeometry = vi.fn();
    const renderer = makeRenderer();
    render(<FloatingImage spec={imageSpec} renderer={renderer} selected onSelect={onSelect} onGeometry={onGeometry} onRemove={onRemove} />);
    // The wrapper div (role=img) and the inner <img> both expose the name.
    const obj = document.querySelector<HTMLElement>('.ss-image-object')!;
    expect(obj.getAttribute('aria-label')).toBe('logo.png');

    fireEvent.keyDown(obj, { key: 'Delete' });
    expect(onRemove).toHaveBeenCalledWith('img-1');
    fireEvent.keyDown(obj, { key: 'ArrowLeft', ctrlKey: true });
    expect(onGeometry).toHaveBeenCalledTimes(1);
    const [, left] = onGeometry.mock.calls[0]!;
    expect(left.from.c).toBe(4); // one default cell left
  });
});

describe('applyGesture / commitAnchor (pure geometry)', () => {
  const base: Rect = { x: 100, y: 100, w: 140, h: 60 };
  const move: Gesture = { mode: 'move', startClientX: 0, startClientY: 0, startRect: base };

  it('move translates without resizing', () => {
    expect(applyGesture(move, 30, -10)).toEqual({ x: 130, y: 90, w: 140, h: 60 });
  });

  it('se-resize grows and never below the minimum size', () => {
    const se: Gesture = { mode: 'se', startClientX: 0, startClientY: 0, startRect: base };
    expect(applyGesture(se, 60, 40)).toEqual({ x: 100, y: 100, w: 200, h: 100 });
    expect(applyGesture(se, -500, -500).w).toBeGreaterThan(0);
  });

  it('w-resize keeps the right edge fixed while shrinking', () => {
    const w: Gesture = { mode: 'w', startClientX: 0, startClientY: 0, startRect: base };
    const next = applyGesture(w, 20, 0);
    expect(next.x).toBe(120);
    expect(next.x + next.w).toBe(240); // right edge unchanged
  });

  it('commitAnchor clamps the rect into the grid client area', () => {
    const renderer = makeRenderer();
    const anchor = commitAnchor(renderer, { x: -500, y: -500, w: 140, h: 60 });
    expect(anchor.from.c).toBeGreaterThanOrEqual(0);
    expect(anchor.from.r).toBeGreaterThanOrEqual(0);
  });
});
