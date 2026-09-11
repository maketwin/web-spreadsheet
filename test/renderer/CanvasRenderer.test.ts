import { fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CanvasRenderer, canvasPointToCell, canvasPointToHeader, ROW_HEADER_WIDTH, COL_HEADER_HEIGHT, ROW_HEIGHT, COL_WIDTH } from '../../src/renderer/CanvasRenderer';
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

    expect(canvasPointToCell(canvas, 10 + ROW_HEADER_WIDTH + 5, 20 + COL_HEADER_HEIGHT + 5)).toEqual({ r: 0, c: 0 });
    expect(canvasPointToCell(canvas, 10 + ROW_HEADER_WIDTH + COL_WIDTH * 2 + 5, 20 + COL_HEADER_HEIGHT + ROW_HEIGHT * 2 + 5)).toEqual({ r: 2, c: 2 });
  });

  it('converts zoomed canvas coordinates to cell addresses', () => {
    const canvas = makeCanvas();

    expect(canvasPointToCell(canvas, 10 + ROW_HEADER_WIDTH + COL_WIDTH * 2 + 5, 20 + COL_HEADER_HEIGHT + ROW_HEIGHT * 2 + 5, 0, 0, 200)).toEqual({ r: 1, c: 1 });
  });

  it('ignores row and column headers during coordinate conversion', () => {
    const canvas = makeCanvas();

    expect(canvasPointToCell(canvas, 40, 50)).toBeNull();
    expect(canvasPointToCell(canvas, 80, 30)).toBeNull();
  });

  it('converts zoomed header coordinates to column addresses', () => {
    const canvas = makeCanvas();

    expect(canvasPointToHeader(canvas, 10 + ROW_HEADER_WIDTH + COL_WIDTH * 2 + 5, 20 + 5, 0, 0, 200)).toEqual({ type: 'column', c: 1 });
  });

  it('emits mousedown cell clicks with converted coordinates', () => {
    installCanvasContext();
    const callbacks = installAnimationFrames();
    const onCellClick = vi.fn();
    const renderer = new CanvasRenderer({ canvas: makeCanvas(), store: new Store(), onCellClick });

    fireEvent.mouseDown(document.querySelector('canvas') as HTMLCanvasElement, { clientX: 10 + ROW_HEADER_WIDTH + COL_WIDTH + 30, clientY: 20 + COL_HEADER_HEIGHT + ROW_HEIGHT + 5 });

    expect(onCellClick).toHaveBeenCalledWith({ r: 1, c: 1 });
    expect(callbacks.length).toBe(1);
    renderer.destroy();
  });

  it('starts a normal range drag from the inside of an edge cell', () => {
    installCanvasContext();
    installAnimationFrames();
    const onCellClick = vi.fn();
    const onSelectionChange = vi.fn();
    const onMoveRange = vi.fn();
    const canvas = makeCanvas();
    const renderer = new CanvasRenderer({
      canvas,
      store: new Store(),
      selectedRange: { r1: 0, c1: 0, r2: 2, c2: 2 },
      selectionKind: 'range',
      activeCell: { r: 0, c: 0 },
      onCellClick,
      onSelectionChange,
      onMoveRange,
    });

    fireEvent.mouseDown(canvas, { clientX: 10 + ROW_HEADER_WIDTH + COL_WIDTH + 50, clientY: 20 + COL_HEADER_HEIGHT + 12 });
    fireEvent.mouseMove(window, { clientX: 10 + ROW_HEADER_WIDTH + COL_WIDTH * 3 + 50, clientY: 20 + COL_HEADER_HEIGHT + ROW_HEIGHT * 2 + 12 });

    expect(onCellClick).toHaveBeenCalledWith({ r: 0, c: 1 });
    expect(onSelectionChange).toHaveBeenCalledWith({ r1: 0, c1: 1, r2: 2, c2: 3 }, { r: 2, c: 3 }, { r: 0, c: 1 });
    expect(onMoveRange).not.toHaveBeenCalled();
    renderer.destroy();
  });

  it('moves a selected range only when dragging the rendered selection border', () => {
    installCanvasContext();
    installAnimationFrames();
    const onMoveRange = vi.fn();
    const canvas = makeCanvas();
    const renderer = new CanvasRenderer({
      canvas,
      store: new Store(),
      selectedRange: { r1: 0, c1: 0, r2: 2, c2: 2 },
      selectionKind: 'range',
      activeCell: { r: 0, c: 0 },
      onMoveRange,
    });

    fireEvent.mouseDown(canvas, { clientX: 10 + ROW_HEADER_WIDTH + COL_WIDTH + 50, clientY: 20 + COL_HEADER_HEIGHT + 2 });
    fireEvent.mouseMove(window, { clientX: 10 + ROW_HEADER_WIDTH + COL_WIDTH * 5 + 50, clientY: 20 + COL_HEADER_HEIGHT + 2 });
    fireEvent.mouseUp(window);

    expect(onMoveRange).toHaveBeenCalledWith({ r1: 0, c1: 0, r2: 2, c2: 2 }, { r1: 0, c1: 4, r2: 0, c2: 4 });
    renderer.destroy();
  });

  it('does not move a range when the selection border is clicked without dragging', () => {
    installCanvasContext();
    installAnimationFrames();
    const onMoveRange = vi.fn();
    const canvas = makeCanvas();
    const renderer = new CanvasRenderer({
      canvas,
      store: new Store(),
      selectedRange: { r1: 0, c1: 0, r2: 2, c2: 2 },
      selectionKind: 'range',
      activeCell: { r: 0, c: 0 },
      onMoveRange,
    });

    fireEvent.mouseDown(canvas, { clientX: 10 + ROW_HEADER_WIDTH + COL_WIDTH + 50, clientY: 20 + COL_HEADER_HEIGHT + 2 });
    fireEvent.mouseUp(window);

    expect(onMoveRange).not.toHaveBeenCalled();
    renderer.destroy();
  });

  it('extends column selection while dragging column headers', () => {
    installCanvasContext();
    installAnimationFrames();
    const onColumnSelect = vi.fn();
    const canvas = makeCanvas();
    const renderer = new CanvasRenderer({ canvas, store: new Store(), onColumnSelect });

    fireEvent.mouseDown(canvas, { clientX: 10 + ROW_HEADER_WIDTH + 5, clientY: 20 + 5 });
    fireEvent.mouseMove(window, { clientX: 10 + ROW_HEADER_WIDTH + COL_WIDTH * 2 + 5, clientY: 20 + 5 });

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

    fireEvent.mouseDown(canvas, { clientX: 10 + 5, clientY: 20 + COL_HEADER_HEIGHT + 5 });
    fireEvent.mouseMove(window, { clientX: 10 + 5, clientY: 20 + COL_HEADER_HEIGHT + ROW_HEIGHT * 2 + 5 });

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
    expect(ctx.fillStyle).toBe('#444444');
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

  it('aligns cell text vertically and defaults to middle', () => {
    const paintText = (valign?: 'top' | 'middle' | 'bottom'): number => {
      const ctx = installCanvasContext();
      const callbacks = installAnimationFrames();
      const store = new Store();
      store.setCell(0, 0, { text: 'A1', styleId: 'style-1' });
      store.setStyle('style-1', valign === undefined ? {} : { valign });
      const renderer = new CanvasRenderer({ canvas: makeCanvas(), store });
      callbacks[0]?.(0);
      const call = (ctx.fillText as ReturnType<typeof vi.fn>).mock.calls.find((items) => items[0] === 'A1');
      renderer.destroy();
      document.body.innerHTML = '';
      vi.restoreAllMocks();
      if (call === undefined) throw new Error('Text was not painted');
      return Number(call[2]);
    };

    expect(paintText()).toBe(paintText('middle'));
    expect(paintText('bottom')).toBeGreaterThan(paintText('top'));
  });

  it('skips non-first cells in merged regions', () => {
    const ctx = installCanvasContext();
    const callbacks = installAnimationFrames();
    const store = new Store();
    store.addMerge('A1:B2');
    store.setCell(0, 0, { text: 'merged' });
    store.setCell(0, 1, { text: 'hidden1' });
    store.setCell(1, 0, { text: 'hidden2' });
    store.setCell(1, 1, { text: 'hidden3' });
    const renderer = new CanvasRenderer({ canvas: makeCanvas(), store });

    callbacks[0]?.(0);

    // Only the first cell's text should be rendered — the other 3 should be skipped
    const allCalls = (ctx.fillText as ReturnType<typeof vi.fn>).mock.calls.map(
      (call: readonly unknown[]) => String(call[0]),
    );
    expect(allCalls).toContain('merged');
    expect(allCalls).not.toContain('hidden1');
    expect(allCalls).not.toContain('hidden2');
    expect(allCalls).not.toContain('hidden3');
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

describe('CanvasRenderer AutoFilter header-row buttons', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('opens the filter popup only when the in-cell dropdown button is clicked', () => {
    installCanvasContext();
    installAnimationFrames();
    const onAutoFilterClick = vi.fn();
    const store = new Store();
    store.setCell(0, 0, { text: 'Name' });
    store.setCell(1, 0, { text: 'Alice' });
    store.setAutoFilter({ range: { r1: 0, c1: 0, r2: 1, c2: 0 }, criteria: {} });
    const canvas = makeCanvas();
    const renderer = new CanvasRenderer({ canvas, store, onAutoFilterClick });

    // Middle of the header cell: plain cell click, no popup.
    fireEvent.mouseDown(canvas, { clientX: 10 + ROW_HEADER_WIDTH + 20, clientY: 20 + COL_HEADER_HEIGHT + 10 });
    expect(onAutoFilterClick).not.toHaveBeenCalled();

    // Column-letter header: selects the column, no popup.
    fireEvent.mouseDown(canvas, { clientX: 10 + ROW_HEADER_WIDTH + 30, clientY: 20 + 10 });
    expect(onAutoFilterClick).not.toHaveBeenCalled();

    // Right edge of the header-row cell (the Excel dropdown button zone).
    fireEvent.mouseDown(canvas, { clientX: 10 + ROW_HEADER_WIDTH + COL_WIDTH - 8, clientY: 20 + COL_HEADER_HEIGHT + 10 });
    expect(onAutoFilterClick).toHaveBeenCalledWith(0, 0, expect.any(Number), expect.any(Number));
    renderer.destroy();
  });
});

describe('CanvasRenderer collapsed (hidden) rows', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  function setup(): { renderer: CanvasRenderer; store: Store } {
    installCanvasContext();
    installAnimationFrames();
    const store = new Store();
    for (let r = 0; r < 5; r += 1) store.setCell(r, 0, { text: `v${r}` });
    const canvas = makeCanvas();
    const renderer = new CanvasRenderer({ canvas, store });
    return { renderer, store };
  }

  it('collapses a hidden row to zero height and shifts lower rows up', () => {
    const { renderer, store } = setup();
    expect(renderer.getCellViewportRect(3, 0)).toEqual({ x: ROW_HEADER_WIDTH, y: COL_HEADER_HEIGHT + 3 * ROW_HEIGHT, w: COL_WIDTH, h: ROW_HEIGHT });
    store.setRow(2, { hide: true });
    expect(renderer.getCellViewportRect(2, 0).h).toBe(0);
    // Excel fold-up: row 3's data now renders where row 2 was.
    expect(renderer.getCellViewportRect(3, 0).y).toBe(COL_HEADER_HEIGHT + 2 * ROW_HEIGHT);
    renderer.destroy();
  });

  it('restores the row height when unhidden', () => {
    const { renderer, store } = setup();
    store.setRow(2, { hide: true });
    store.setRow(2, { hide: false });
    expect(renderer.getCellViewportRect(2, 0).h).toBe(ROW_HEIGHT);
    expect(renderer.getCellViewportRect(3, 0).y).toBe(COL_HEADER_HEIGHT + 3 * ROW_HEIGHT);
    renderer.destroy();
  });

  it('maps clicks in the collapsed slot to the next visible row', () => {
    const { renderer, store } = setup();
    store.setRow(2, { hide: true });
    // Canvas y inside the collapsed slot's former area maps to row 3 (canvas top = 20).
    const hit = renderer.rowAtPoint(20 + COL_HEADER_HEIGHT + 2 * ROW_HEIGHT + 5);
    expect(hit).toBe(3);
    renderer.destroy();
  });
});
