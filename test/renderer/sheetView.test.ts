import { afterEach, describe, expect, it, vi } from 'vitest';
import { CanvasRenderer } from '../../src/renderer/CanvasRenderer';
import { Store } from '../../src/store/Store';
import { Range, type RangeAddress } from '../../src/selection/Range';
import type { CellAddress } from '../../src/renderer/coordinate';

/**
 * Excel: every sheet keeps its own view. The sheet being left keeps its
 * scroll position, the sheet entered returns to where it was left — or to
 * the top-left when it was never scrolled. (Before: one scroll position was
 * shared by every sheet, so a sheet switched to after scrolling another one
 * opened at the bottom.)
 */
function makeCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'clientWidth', { configurable: true, value: 300 });
  Object.defineProperty(canvas, 'clientHeight', { configurable: true, value: 150 });
  Object.defineProperty(canvas, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ left: 0, top: 0, width: 300, height: 150, right: 300, bottom: 150, x: 0, y: 0, toJSON: () => ({}) }),
  });
  document.body.append(canvas);
  return canvas;
}

function installCanvasContext(): void {
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
    setLineDash: vi.fn(),
    setTransform: vi.fn(),
    stroke: vi.fn(),
    strokeRect: vi.fn(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as CanvasRenderingContext2D);
}

/** Collects animation-frame callbacks; `frames(n)` renders n frames. */
function installAnimationFrames(): { frames: (n: number) => void } {
  const callbacks: FrameRequestCallback[] = [];
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { callbacks.push(cb); return callbacks.length; });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
  return { frames: (n) => { for (let i = 0; i < n; i += 1) callbacks.splice(0).forEach((cb) => cb(0)); } };
}

describe('each sheet keeps its own scroll position', () => {
  const renderers: CanvasRenderer[] = [];
  afterEach(() => { renderers.splice(0).forEach((renderer) => renderer.destroy()); vi.restoreAllMocks(); document.body.innerHTML = ''; });

  function makeRenderer(store: Store): CanvasRenderer {
    installCanvasContext();
    const renderer = new CanvasRenderer({ canvas: makeCanvas(), store, devicePixelRatio: 1 });
    renderers.push(renderer);
    return renderer;
  }

  it('a sheet switched to after scrolling another one opens at the top-left; each sheet returns to where it was left', () => {
    const store = new Store();
    const first = store.getActiveSheetId();
    const renderer = makeRenderer(store);

    renderer.scrollBy(0, 5000);
    expect(renderer.scrollState()).toEqual({ left: 0, top: 5000 });

    // addSheet activates the new sheet: it was never scrolled, so it opens at the top-left.
    const second = store.addSheet('Second');
    expect(store.getActiveSheetId()).toBe(second);
    expect(renderer.scrollState()).toEqual({ left: 0, top: 0 });

    renderer.scrollBy(300, 700);
    store.activateSheet(first);
    expect(renderer.scrollState()).toEqual({ left: 0, top: 5000 });
    store.activateSheet(second);
    expect(renderer.scrollState()).toEqual({ left: 300, top: 700 });
  });

  it('a position comes back at the row and column it was left at, whatever the zoom is now', () => {
    const store = new Store();
    const first = store.getActiveSheetId();
    const renderer = makeRenderer(store);

    // Row heights scale with zoom: 4,000 px is row 200 at 100% and row 200 again at 200%.
    renderer.scrollBy(0, 4000);
    store.addSheet('Second');
    renderer.setViewOptions({ zoom: 200 });
    store.activateSheet(first);
    expect(renderer.scrollState()).toEqual({ left: 0, top: 8000 });
  });

  it('deleting the active sheet brings the next one back with its own view', () => {
    const store = new Store();
    const first = store.getActiveSheetId();
    const renderer = makeRenderer(store);

    renderer.scrollBy(0, 1000);
    const second = store.addSheet('Second');
    renderer.scrollBy(0, 200);
    store.deleteSheet(second);
    expect(store.getActiveSheetId()).toBe(first);
    expect(renderer.scrollState()).toEqual({ left: 0, top: 1000 });
  });

  it('a replaced workbook starts at the top-left and forgets the views of the sheets it replaces', () => {
    const store = new Store();
    const renderer = makeRenderer(store);

    renderer.scrollBy(0, 5000);
    store.addSheet('Second');
    // The new workbook reuses the id "sheet-1": its sheet was never scrolled.
    store.replaceAll(new Store().serialize());
    expect(renderer.scrollState()).toEqual({ left: 0, top: 0 });
  });
});

describe('frozen panes re-applied after a sheet switch', () => {
  const renderers: CanvasRenderer[] = [];
  afterEach(() => { renderers.splice(0).forEach((renderer) => renderer.destroy()); vi.restoreAllMocks(); document.body.innerHTML = ''; });

  /** Sheet 1 left at 3,000 px, sheet 2 then entered and left at 5,000 px, then sheet 1 and sheet 2 again: the switch's restored view is sheet 2's 5,000. `advance` moves the clock. */
  function setup(): { renderer: CanvasRenderer; advance: (ms: number) => void } {
    installCanvasContext();
    let now = 10_000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const store = new Store();
    const first = store.getActiveSheetId();
    const renderer = new CanvasRenderer({ canvas: makeCanvas(), store, devicePixelRatio: 1 });
    renderers.push(renderer);
    renderer.scrollBy(0, 3000);
    const second = store.addSheet('Second');
    renderer.scrollBy(0, 5000);
    store.activateSheet(first);
    store.activateSheet(second);
    return { renderer, advance: (ms) => { now += ms; } };
  }

  it('do not wipe the view that was just restored', () => {
    const { renderer } = setup();
    expect(renderer.scrollState()).toEqual({ left: 0, top: 5000 });
    // The view shows the active sheet's panes and re-applies them when a switch changes them.
    renderer.setFreeze(2, 0);
    expect(renderer.scrollState()).toEqual({ left: 0, top: 5000 });
  });

  it('a change of panes on the sheet itself still starts at the freeze corner once the switch is over', () => {
    const { renderer, advance } = setup();
    advance(1_000);
    renderer.setFreeze(0, 0);
    expect(renderer.scrollState()).toEqual({ left: 0, top: 0 });
  });

  it('ends as soon as the user scrolls: the sheet is where they put it', () => {
    const { renderer } = setup();
    renderer.scrollBy(0, 250);
    expect(renderer.scrollState()).toEqual({ left: 0, top: 5250 });
    renderer.setFreeze(2, 0);
    expect(renderer.scrollState()).toEqual({ left: 0, top: 0 });
  });
});

/** Canvas 300×150, a row 20 px: the scroll offset that leaves row `r` as the last one fully in view. */
const wheeledTo = (r: number): number => r * 20 + 20 - 130;
const ORIGIN: CellAddress = { r: 0, c: 0 };
const single = (r: number, c: number): RangeAddress => Range.single(r, c).toAddress();

describe("the sheet's own selection coming back after a switch", () => {
  const renderers: CanvasRenderer[] = [];
  afterEach(() => { renderers.splice(0).forEach((renderer) => renderer.destroy()); vi.restoreAllMocks(); document.body.innerHTML = ''; });

  /** Sheet 1 left wheeled down to 5,000 px with A1 still active; sheet 2 then selects a far cell of its own; back on sheet 1. */
  function wheeledAway(): CanvasRenderer {
    const store = new Store();
    const first = store.getActiveSheetId();
    installCanvasContext();
    const renderer = new CanvasRenderer({ canvas: makeCanvas(), store, selectedRange: single(0, 0), selectionKind: 'cell', activeCell: ORIGIN, devicePixelRatio: 1 });
    renderers.push(renderer);
    renderer.scrollBy(0, 5000);
    store.addSheet('Second');
    renderer.setSelection(single(450, 0), 'cell', { r: 450, c: 0 });
    store.activateSheet(first);
    return renderer;
  }

  it('does not move the view the switch restored — the wheel, not the active cell, is where the sheet was left', () => {
    const renderer = wheeledAway();
    expect(renderer.scrollState()).toEqual({ left: 0, top: 5000 });
    // The shell hands over sheet 1's own selection (A1): the active cell moved — from sheet 2's — and is off-screen.
    renderer.setSelection(single(0, 0), 'cell', ORIGIN);
    expect(renderer.scrollState()).toEqual({ left: 0, top: 5000 });
  });

  it('is spent by that one re-sync: an active cell that moves afterwards scrolls into sight as usual', () => {
    const renderer = wheeledAway();
    renderer.setSelection(single(0, 0), 'cell', ORIGIN);
    renderer.setSelection(single(800, 0), 'cell', { r: 800, c: 0 });
    expect(renderer.scrollState()).toEqual({ left: 0, top: wheeledTo(800) });
    // Re-syncing the same selection still never yanks the view.
    renderer.setSelection(single(800, 0), 'cell', { r: 800, c: 0 });
    expect(renderer.scrollState()).toEqual({ left: 0, top: wheeledTo(800) });
  });

  it('a jump reveals its cell, even where the active cell does not move', () => {
    const renderer = wheeledAway();
    renderer.setSelection(single(0, 0), 'cell', ORIGIN, true);
    expect(renderer.scrollState()).toEqual({ left: 0, top: 0 });
  });

  it('keeps the target in view when the panes are re-applied in the same round', () => {
    const now = 10_000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const renderer = wheeledAway();
    renderer.setSelection(single(600, 0), 'cell', { r: 600, c: 0 }, true);
    expect(renderer.scrollState()).toEqual({ left: 0, top: wheeledTo(600) });
    // `setFreeze` starts the unfrozen pane at the freeze corner; the jump's target outranks that for this round.
    renderer.setFreeze(2, 0);
    expect(renderer.scrollState()).toEqual({ left: 0, top: wheeledTo(600) });
  });

  it('a jump is forgotten once its frame is drawn: a later change of panes starts at the freeze corner', () => {
    const frames = installAnimationFrames();
    const renderer = wheeledAway();
    renderer.setSelection(single(600, 0), 'cell', { r: 600, c: 0 }, true);
    expect(renderer.scrollState().top).toBe(wheeledTo(600));
    frames.frames(1);
    renderer.setFreeze(2, 0);
    expect(renderer.scrollState()).toEqual({ left: 0, top: 0 });
  });
});

describe('an edit starting on a cell that was wheeled out of sight', () => {
  const renderers: CanvasRenderer[] = [];
  afterEach(() => { renderers.splice(0).forEach((renderer) => renderer.destroy()); vi.restoreAllMocks(); document.body.innerHTML = ''; });

  /** Sheet 1 left wheeled down to 5,000 px with A1 still active, then left and entered again. */
  function leftWheeled(): CanvasRenderer {
    const store = new Store();
    const first = store.getActiveSheetId();
    installCanvasContext();
    const renderer = new CanvasRenderer({ canvas: makeCanvas(), store, devicePixelRatio: 1 });
    renderers.push(renderer);
    renderer.scrollBy(0, 5000);
    store.addSheet('Second');
    renderer.scrollBy(0, 9000);
    store.activateSheet(first);
    return renderer;
  }

  it('brings that cell into view, and the view is no longer the one a switch restored', () => {
    const now = 10_000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const renderer = leftWheeled();
    expect(renderer.scrollState()).toEqual({ left: 0, top: 5000 });

    renderer.revealCell(700, 0);
    expect(renderer.scrollState()).toEqual({ left: 0, top: wheeledTo(700) });
    // Neither the restored 5,000 nor the freeze corner comes back with the panes.
    renderer.setFreeze(2, 0);
    expect(renderer.scrollState()).toEqual({ left: 0, top: wheeledTo(700) });
  });

  it('does nothing while the cell is already on screen', () => {
    const renderer = leftWheeled();
    renderer.scrollBy(0, -2000);
    // Rows 150–155 are on screen at 3,000 px (the grid area holds six rows and a half).
    renderer.revealCell(152, 0);
    expect(renderer.scrollState()).toEqual({ left: 0, top: 3000 });
  });
});
