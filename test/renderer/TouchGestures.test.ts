import { fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CanvasRenderer, COL_WIDTH, COL_HEADER_HEIGHT, ROW_HEADER_WIDTH } from '../../src/renderer/CanvasRenderer';
import { ROW_HEIGHT } from '../../src/renderer/coordinate';
import { Store } from '../../src/store/Store';

function makeCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'clientWidth', { configurable: true, value: 800 });
  Object.defineProperty(canvas, 'clientHeight', { configurable: true, value: 600 });
  Object.defineProperty(canvas, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => ({}) }),
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

/** jsdom has no PointerEvent — hand out a MouseEvent with pointer fields patched on. */
function pointerEvent(type: string, opts: { x: number; y: number; id?: number; pointerType?: string }): PointerEvent {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: opts.x, clientY: opts.y, button: 0 });
  Object.defineProperty(ev, 'pointerId', { value: opts.id ?? 1 });
  Object.defineProperty(ev, 'pointerType', { value: opts.pointerType ?? 'touch' });
  return ev as unknown as PointerEvent;
}

/** A seeded 60-row sheet so there is something to pan down to. */
function seedStore(): Store {
  const store = new Store();
  for (let r = 0; r < 60; r += 1) store.setCell(r, 0, { text: `r${r}` });
  return store;
}

const cellPoint = (r: number, c: number): { x: number; y: number } => ({
  x: ROW_HEADER_WIDTH + c * COL_WIDTH + 10,
  y: COL_HEADER_HEIGHT + r * ROW_HEIGHT + 10,
});

describe('touch gestures (pan / long-press / tap)', () => {
  beforeEach(() => { installCtx(); vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1); vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined); });
  afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });

  it('a one-finger drag pans the sheet instead of pulling a selection', () => {
    const store = seedStore();
    const onSelectionChange = vi.fn();
    const canvas = makeCanvas();
    const renderer = new CanvasRenderer({ canvas, store, onSelectionChange });
    // Cell (40, 0) starts below the fold.
    expect(renderer.getCellViewportRect(40, 0).y).toBeGreaterThan(600);

    const from = cellPoint(1, 0);
    canvas.dispatchEvent(pointerEvent('pointerdown', from));
    // 300px of finger travel upward = 300px of scroll down (increments, not
    // cumulative-from-origin — see the pan scroll fix).
    for (let i = 1; i <= 10; i += 1) window.dispatchEvent(pointerEvent('pointermove', { x: from.x, y: from.y - i * 30 }));
    window.dispatchEvent(pointerEvent('pointerup', { x: from.x, y: from.y - 300 }));
    expect(renderer.getCellViewportRect(40, 0).y).toBeLessThan(600);
    // A pan is not a selection gesture: no drag-origin flip reported.
    expect(onSelectionChange).not.toHaveBeenCalled();
    renderer.destroy();
  });

  it('a finger that stays put is still a tap: the cell gets selected', () => {
    const store = seedStore();
    const onCellClick = vi.fn();
    const canvas = makeCanvas();
    const renderer = new CanvasRenderer({ canvas, store, onCellClick });
    const p = cellPoint(2, 0);
    canvas.dispatchEvent(pointerEvent('pointerdown', p));
    window.dispatchEvent(pointerEvent('pointermove', { x: p.x + 2, y: p.y + 2 })); // within slop
    window.dispatchEvent(pointerEvent('pointerup', { x: p.x + 2, y: p.y + 2 }));
    // Taps report through the click path (the host wraps it into a selection),
    // exactly like a desktop click.
    expect(onCellClick).toHaveBeenCalledTimes(1);
    expect(onCellClick.mock.calls[0]?.[0]).toEqual({ r: 2, c: 0 });
    renderer.destroy();
  });

  it('a long-press opens the context menu path without further selection churn', () => {
    vi.useFakeTimers();
    try {
      const store = seedStore();
      const onCellContextMenu = vi.fn();
      const onSelectionChange = vi.fn();
      const canvas = makeCanvas();
      const renderer = new CanvasRenderer({ canvas, store, onCellContextMenu, onSelectionChange });
      const p = cellPoint(3, 0);
      canvas.dispatchEvent(pointerEvent('pointerdown', p));
      vi.advanceTimersByTime(600);
      expect(onCellContextMenu).toHaveBeenCalledTimes(1);
      const [cell, x, y] = onCellContextMenu.mock.calls[0] as [unknown, number, number];
      expect(cell).toEqual({ r: 3, c: 0 });
      expect(x).toBe(p.x);
      expect(y).toBe(p.y);
      // The following mouseup (finger lift) must not flip the selection again.
      window.dispatchEvent(pointerEvent('pointerup', p));
      expect(onSelectionChange).not.toHaveBeenCalled();
      renderer.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('finger movement or a second pointer cancels the pending long-press', () => {
    vi.useFakeTimers();
    try {
      const store = seedStore();
      const onCellContextMenu = vi.fn();
      const canvas = makeCanvas();
      const renderer = new CanvasRenderer({ canvas, store, onCellContextMenu });

      // Movement beyond the long-press slop cancels.
      const p = cellPoint(1, 0);
      canvas.dispatchEvent(pointerEvent('pointerdown', p));
      window.dispatchEvent(pointerEvent('pointermove', { x: p.x, y: p.y - 40 }));
      vi.advanceTimersByTime(700);
      expect(onCellContextMenu).not.toHaveBeenCalled();
      window.dispatchEvent(pointerEvent('pointerup', p));

      // A genuinely two-finger gesture (pinch start) cancels too: both
      // pointers stay down and the menu must never fire.
      const q = cellPoint(5, 0);
      canvas.dispatchEvent(pointerEvent('pointerdown', { ...q, id: 1 }));
      canvas.dispatchEvent(pointerEvent('pointerdown', { ...q, id: 2 }));
      vi.advanceTimersByTime(700);
      expect(onCellContextMenu).not.toHaveBeenCalled();
      renderer.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('mouse gestures are untouched: drag still selects a range', () => {
    const store = seedStore();
    const onSelectionChange = vi.fn();
    const canvas = makeCanvas();
    const renderer = new CanvasRenderer({ canvas, store, onSelectionChange });
    const a = cellPoint(1, 0);
    const b = cellPoint(3, 0);
    fireEvent.mouseDown(canvas, { clientX: a.x, clientY: a.y });
    fireEvent.mouseMove(window, { clientX: b.x, clientY: b.y });
    expect(onSelectionChange).toHaveBeenCalled();
    const range = onSelectionChange.mock.calls.at(-1)?.[0] as { r1: number; r2: number };
    expect(range.r1).toBe(1);
    expect(range.r2).toBe(3);
    renderer.destroy();
  });

  it('pressing to pan does not select the cell under the finger', () => {
    const store = seedStore();
    const onCellClick = vi.fn();
    const canvas = makeCanvas();
    const renderer = new CanvasRenderer({ canvas, store, onCellClick, selectedRange: { r1: 0, c1: 0, r2: 4, c2: 1 } });
    const p = cellPoint(20, 0);
    // Press alone must not collapse the selection / fire a click — the cell
    // selection is deferred to the lift, which a pan never reaches.
    canvas.dispatchEvent(pointerEvent('pointerdown', p));
    expect(onCellClick).not.toHaveBeenCalled();
    window.dispatchEvent(pointerEvent('pointermove', { x: p.x, y: p.y - 60 }));
    window.dispatchEvent(pointerEvent('pointerup', { x: p.x, y: p.y - 60 }));
    expect(onCellClick).not.toHaveBeenCalled();
    // A following clean tap still selects normally. The pan scrolled 60px
    // (3 rows), so the same screen point now lands on row 5.
    const q = cellPoint(2, 0);
    canvas.dispatchEvent(pointerEvent('pointerdown', q));
    window.dispatchEvent(pointerEvent('pointerup', q));
    expect(onCellClick).toHaveBeenCalledTimes(1);
    expect(onCellClick.mock.calls[0]?.[0]).toEqual({ r: 5, c: 0 });
    renderer.destroy();
  });

  it('a second finger mid fill-drag cancels the drag instead of leaking it', () => {
    const store = seedStore();
    const onFill = vi.fn();
    const onCellClick = vi.fn();
    const canvas = makeCanvas();
    const renderer = new CanvasRenderer({ canvas, store, onFill, onCellClick, selectedRange: { r1: 0, c1: 0, r2: 1, c2: 1 } });
    // Press on the fill handle (bottom-right corner of the selection).
    const handle = { x: ROW_HEADER_WIDTH + 2 * COL_WIDTH - 5, y: COL_HEADER_HEIGHT + 2 * ROW_HEIGHT - 5 };
    canvas.dispatchEvent(pointerEvent('pointerdown', handle));
    window.dispatchEvent(pointerEvent('pointermove', { x: handle.x, y: handle.y + 80 }));
    // A palm/second finger lands: the drag must be CANCELLED, not abandoned —
    // an abandoned drag would commit a phantom fill on the next tap's up.
    canvas.dispatchEvent(pointerEvent('pointerdown', { x: 400, y: 100, id: 2 }));
    window.dispatchEvent(pointerEvent('pointerup', { x: 400, y: 100, id: 2 }));
    window.dispatchEvent(pointerEvent('pointerup', handle));
    expect(onFill).not.toHaveBeenCalled();
    // The next tap must not trigger the ghost commit either.
    const q = cellPoint(8, 0);
    canvas.dispatchEvent(pointerEvent('pointerdown', q));
    window.dispatchEvent(pointerEvent('pointerup', q));
    expect(onFill).not.toHaveBeenCalled();
    expect(onCellClick).toHaveBeenCalledTimes(1);
    renderer.destroy();
  });

  it('pointercancel aborts a fill drag without committing', () => {
    const store = seedStore();
    const onFill = vi.fn();
    const canvas = makeCanvas();
    const renderer = new CanvasRenderer({ canvas, store, onFill, selectedRange: { r1: 0, c1: 0, r2: 1, c2: 1 } });
    const handle = { x: ROW_HEADER_WIDTH + 2 * COL_WIDTH - 5, y: COL_HEADER_HEIGHT + 2 * ROW_HEIGHT - 5 };
    canvas.dispatchEvent(pointerEvent('pointerdown', handle));
    window.dispatchEvent(pointerEvent('pointermove', { x: handle.x, y: handle.y + 80 }));
    window.dispatchEvent(pointerEvent('pointercancel', handle));
    const q = cellPoint(8, 0);
    canvas.dispatchEvent(pointerEvent('pointerdown', q));
    window.dispatchEvent(pointerEvent('pointerup', q));
    expect(onFill).not.toHaveBeenCalled();
    renderer.destroy();
  });

  it('lifting one finger of a pinch rebases the zoom on the survivors (no jump)', () => {
    const store = seedStore();
    const onZoomTo = vi.fn();
    const canvas = makeCanvas();
    const renderer = new CanvasRenderer({ canvas, store, onZoomTo });
    const a = { x: 200, y: 300 };
    const b = { x: 300, y: 300 };
    canvas.dispatchEvent(pointerEvent('pointerdown', a));
    canvas.dispatchEvent(pointerEvent('pointerdown', { ...b, id: 2 }));
    onZoomTo.mockClear();
    // A third finger joins, then one of the ORIGINAL pair lifts: the base must
    // be recomputed on the remaining pair instead of jumping against the stale
    // 100px distance.
    canvas.dispatchEvent(pointerEvent('pointerdown', { x: 500, y: 300, id: 3 }));
    window.dispatchEvent(pointerEvent('pointerup', { ...b, id: 2 }));
    onZoomTo.mockClear();
    // Survivors: a (200) and finger 3 (500) — base distance 300. Pinch in to
    // 200 → 100 * (200/300) ≈ 66.7 (NOT the 200 clamp a stale base gives).
    window.dispatchEvent(pointerEvent('pointermove', { x: 400, y: 300, id: 3 }));
    expect(onZoomTo).toHaveBeenCalled();
    const zoom = onZoomTo.mock.calls.at(-1)?.[0] as number;
    expect(zoom).toBeGreaterThan(60);
    expect(zoom).toBeLessThan(75);
    renderer.destroy();
  });
});

describe('scrollCellIntoView (soft keyboard case)', () => {
  beforeEach(() => { installCtx(); vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1); vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined); });
  afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });

  it('brings a below-the-fold cell into view', () => {
    const store = seedStore();
    const canvas = makeCanvas();
    const renderer = new CanvasRenderer({ canvas, store });
    renderer.scrollCellIntoView(50, 0);
    const rect = renderer.getCellViewportRect(50, 0);
    expect(rect.y).toBeGreaterThanOrEqual(COL_HEADER_HEIGHT);
    expect(rect.y + rect.h).toBeLessThanOrEqual(600);
    renderer.destroy();
  });

  it('honours a keyboard-reduced visible height', () => {
    const store = seedStore();
    const canvas = makeCanvas();
    const renderer = new CanvasRenderer({ canvas, store });
    // Only 200px of grid visible above the keyboard.
    renderer.scrollCellIntoView(50, 0, 200);
    const rect = renderer.getCellViewportRect(50, 0);
    expect(rect.y).toBeGreaterThanOrEqual(COL_HEADER_HEIGHT);
    expect(rect.y + rect.h).toBeLessThanOrEqual(COL_HEADER_HEIGHT + 200 + 0.5);
    renderer.destroy();
  });

  it('never scrolls a frozen cell (it is always on screen)', () => {
    const store = seedStore();
    const canvas = makeCanvas();
    const renderer = new CanvasRenderer({ canvas, store });
    renderer.setFreeze(2, 0);
    renderer.scrollCellIntoView(1, 0, 200);
    const rect = renderer.getCellViewportRect(1, 0);
    expect(rect.y).toBeGreaterThanOrEqual(COL_HEADER_HEIGHT);
    renderer.destroy();
  });
});
