import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SpreadsheetComponent } from '../../src/index';
import { CanvasRenderer } from '../../src/renderer/CanvasRenderer';
import { Store } from '../../src/store/Store';

/** Canvas 300×150 at the origin: column c spans `46 + 64c … `, row r `20 + 20r … ` (headers 46 / 20 px). */
function installCanvas(): void {
  const ctx: Partial<CanvasRenderingContext2D> = {
    beginPath: vi.fn(),
    clip: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    lineTo: vi.fn(),
    measureText: vi.fn(() => ({ width: 24 }) as TextMetrics),
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
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
  Object.defineProperty(HTMLCanvasElement.prototype, 'clientWidth', { configurable: true, get: () => 300 });
  Object.defineProperty(HTMLCanvasElement.prototype, 'clientHeight', { configurable: true, get: () => 150 });
}

function mount(store: Store): { canvas: HTMLCanvasElement; nameBox: () => string; clickCell: (r: number, c: number, init?: MouseEventInit) => void; clickTab: (index: number) => void } {
  render(<SpreadsheetComponent store={store} theme={false} />);
  const canvas = document.querySelector('canvas.ss-canvas') as HTMLCanvasElement;
  Object.defineProperty(canvas, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ left: 0, top: 0, width: 300, height: 150, right: 300, bottom: 150, x: 0, y: 0, toJSON: () => ({}) }),
  });
  return {
    canvas,
    nameBox: () => (screen.getByLabelText('Selected cell') as HTMLInputElement).value,
    clickCell: (r, c, init = {}) => fireEvent.mouseDown(canvas, { clientX: 46 + c * 64 + 32, clientY: 20 + r * 20 + 10, ...init }),
    clickTab: (index) => fireEvent.click(screen.getAllByRole('tab')[index] as HTMLElement),
  };
}

/** Two sheets, the first one active. */
function twoSheets(): { store: Store; first: string; second: string } {
  const store = new Store();
  const first = store.getActiveSheetId();
  const second = store.addSheet('Second');
  store.activateSheet(first);
  return { store, first, second };
}

describe('the selection belongs to the sheet', () => {
  beforeEach(installCanvas);
  afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });

  it('a sheet entered shows its own selection, or A1 when it has none — from a tab and from a host call alike', () => {
    const { store, first, second } = twoSheets();
    const ui = mount(store);
    ui.clickCell(2, 1);
    expect(ui.nameBox()).toBe('B3');

    ui.clickTab(1);
    expect(store.getActiveSheetId()).toBe(second);
    expect(ui.nameBox()).toBe('A1');
    ui.clickCell(4, 2);
    expect(ui.nameBox()).toBe('C5');

    ui.clickTab(0);
    expect(ui.nameBox()).toBe('B3');
    ui.clickTab(1);
    expect(ui.nameBox()).toBe('C5');

    act(() => { store.activateSheet(first); });
    expect(ui.nameBox()).toBe('B3');
    act(() => { store.activateSheet(second); });
    expect(ui.nameBox()).toBe('C5');
  });

  it('the formula bar reads the active cell of the sheet on screen', () => {
    const { store, first, second } = twoSheets();
    store.setCell(2, 1, { text: 'one' }, first);
    store.setCell(4, 2, { text: 'two' }, second);
    const ui = mount(store);
    ui.clickCell(2, 1);
    const formulaBar = (): string => (screen.getByLabelText('Formula bar') as HTMLInputElement).value;
    expect(formulaBar()).toBe('one');

    ui.clickTab(1);
    expect(formulaBar()).toBe('');
    ui.clickCell(4, 2);
    expect(formulaBar()).toBe('two');
    ui.clickTab(0);
    expect(ui.nameBox()).toBe('B3');
    expect(formulaBar()).toBe('one');
  });

  it('the extra ranges of a multi-selection do not outlive their sheet', () => {
    const { store } = twoSheets();
    const ui = mount(store);
    const setExtraRanges = vi.spyOn(CanvasRenderer.prototype, 'setExtraRanges');
    ui.clickCell(2, 1);
    ui.clickCell(5, 5, { ctrlKey: true });
    expect(setExtraRanges.mock.lastCall?.[0] ?? []).toHaveLength(1);

    ui.clickTab(1);
    expect(setExtraRanges.mock.lastCall?.[0]).toEqual([]);
  });

  it('a replaced workbook starts over at A1', () => {
    const { store } = twoSheets();
    const ui = mount(store);
    ui.clickCell(2, 1);
    expect(ui.nameBox()).toBe('B3');

    act(() => { store.replaceAll(new Store().serialize()); });
    expect(ui.nameBox()).toBe('A1');
    // The sheets it replaces are not there to come back to with their selections.
    act(() => { store.addSheet('New'); });
    act(() => { store.activateSheet(store.getSheets()[0]!.id); });
    expect(ui.nameBox()).toBe('A1');
  });

  it('an edit still open when the host switches sheets ends there and is written nowhere', () => {
    const { store, first, second } = twoSheets();
    const ui = mount(store);
    ui.clickCell(2, 1);
    fireEvent.keyDown(ui.canvas, { key: 'x' });
    expect(screen.getByLabelText('Cell editor')).toHaveValue('x');

    act(() => { store.activateSheet(second); });
    expect(screen.queryByLabelText('Cell editor')).not.toBeInTheDocument();
    expect(store.getActiveSheetId()).toBe(second);
    expect(ui.nameBox()).toBe('A1');
    expect(store.getCell(2, 1, first)).toBeUndefined();
    expect(store.getCell(2, 1, second)).toBeUndefined();
  });
});

describe('a jump reveals its cell', () => {
  beforeEach(installCanvas);
  afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });

  it('the name box brings the target into view even though it is already the active cell', () => {
    const { store } = twoSheets();
    const ui = mount(store);
    ui.clickCell(4, 1);
    expect(ui.nameBox()).toBe('B5');
    fireEvent.wheel(ui.canvas, { deltaY: 5000 });
    const renderer = rendererOf();
    expect(renderer.scrollState()).toEqual({ left: 0, top: 5000 });

    const setSelection = vi.spyOn(CanvasRenderer.prototype, 'setSelection');
    const nameBox = screen.getByLabelText('Selected cell');
    fireEvent.focus(nameBox);
    fireEvent.change(nameBox, { target: { value: 'B5' } });
    fireEvent.keyDown(nameBox, { key: 'Enter' });
    expect(ui.nameBox()).toBe('B5');
    expect(setSelection.mock.lastCall?.[3]).toBe(true);
    // A cell above the viewport lands right under the column header: row 5 starts at 80 px.
    expect(renderer.scrollState()).toEqual({ left: 0, top: 80 });
  });

  it('a hyperlink into another sheet lands on its target, in view', () => {
    const { store, first, second } = twoSheets();
    store.setCell(0, 5, { text: 'go', hyperlink: { target: 'Second!B400' } }, first);
    const ui = mount(store);
    const setSelection = vi.spyOn(CanvasRenderer.prototype, 'setSelection');

    ui.clickCell(0, 5, { ctrlKey: true });
    expect(store.getActiveSheetId()).toBe(second);
    expect(ui.nameBox()).toBe('B400');
    expect(setSelection.mock.lastCall?.[2]).toEqual({ r: 399, c: 1 });
    expect(setSelection.mock.lastCall?.[3]).toBe(true);
    // Row 400 ends as the last one fully in view: 400 rows × 20 px, less the 130 px grid area.
    expect(rendererOf().scrollState()).toEqual({ left: 0, top: 399 * 20 + 20 - 130 });
  });
});

describe('an edit starting on a cell out of sight', () => {
  beforeEach(installCanvas);
  afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });

  it('typing brings the cell into view before the editor opens on it', () => {
    const { store } = twoSheets();
    const ui = mount(store);
    const revealCell = vi.spyOn(CanvasRenderer.prototype, 'revealCell');
    ui.clickCell(4, 1);
    fireEvent.wheel(ui.canvas, { deltaY: 5000 });
    const renderer = rendererOf();
    expect(renderer.scrollState()).toEqual({ left: 0, top: 5000 });
    expect(revealCell).not.toHaveBeenCalled();

    fireEvent.keyDown(ui.canvas, { key: 'x' });
    expect(revealCell).toHaveBeenCalledTimes(1);
    expect(revealCell).toHaveBeenLastCalledWith(4, 1);
    expect(renderer.scrollState()).toEqual({ left: 0, top: 80 });
    expect(screen.getByLabelText('Cell editor')).toHaveValue('x');
  });

  it('F2 does the same', () => {
    const { store } = twoSheets();
    const ui = mount(store);
    const revealCell = vi.spyOn(CanvasRenderer.prototype, 'revealCell');
    ui.clickCell(4, 1);
    fireEvent.wheel(ui.canvas, { deltaY: 5000 });

    fireEvent.keyDown(ui.canvas, { key: 'F2' });
    expect(revealCell).toHaveBeenLastCalledWith(4, 1);
    expect(rendererOf().scrollState()).toEqual({ left: 0, top: 80 });
  });
});

/** The renderer behind the mounted sheet, found through React's fiber tree (it is not exposed on the DOM). */
function rendererOf(): CanvasRenderer {
  const canvas = document.querySelector('canvas.ss-canvas') as HTMLCanvasElement;
  const key = Object.keys(canvas).find((k) => k.startsWith('__reactFiber$')) as string;
  type Fiber = { return: unknown; memoizedState: unknown };
  type Hook = { next: unknown; memoizedState: unknown };
  let fiber = (canvas as unknown as Record<string, unknown>)[key] as Fiber | null;
  while (fiber !== null) {
    let hook = fiber.memoizedState as Hook | null;
    while (hook !== null && typeof hook === 'object' && 'memoizedState' in hook) {
      const value = hook.memoizedState as { current?: unknown } | null;
      const candidate = value?.current;
      if (candidate !== null && typeof candidate === 'object' && typeof (candidate as CanvasRenderer).scrollState === 'function') return candidate as CanvasRenderer;
      hook = hook.next as Hook | null;
    }
    fiber = fiber.return as Fiber | null;
  }
  throw new Error('renderer not found');
}
