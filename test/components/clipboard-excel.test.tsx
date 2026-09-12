import { fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpreadsheetComponent } from '../../src/index';
import { Store } from '../../src/store/Store';

function installCanvasContext(): void {
  const ctx: Partial<CanvasRenderingContext2D> = {
    beginPath: vi.fn(), clip: vi.fn(), fillRect: vi.fn(), fillText: vi.fn(), rect: vi.fn(),
    restore: vi.fn(), save: vi.fn(), scale: vi.fn(), setLineDash: vi.fn(), setTransform: vi.fn(), strokeRect: vi.fn(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as CanvasRenderingContext2D);
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
}

function installClipboard(): void {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined), readText: vi.fn().mockResolvedValue('external') },
  });
}

function setup(initial: [number, number, string][]): { store: Store; canvas: HTMLCanvasElement } {
  installCanvasContext();
  installClipboard();
  const store = new Store();
  for (const [r, c, text] of initial) store.setCell(r, c, { text });
  render(<SpreadsheetComponent store={store} theme={false} />);
  return { store, canvas: document.querySelector('canvas') as HTMLCanvasElement };
}

describe('Excel clipboard behavior', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    document.body.innerHTML = '';
  });

  it('cut keeps the source content until the paste lands', async () => {
    const { store, canvas } = setup([[0, 0, 'hello']]);
    fireEvent.keyDown(canvas, { key: 'x', ctrlKey: true });
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled());
    // Excel: the source still holds its content while the ants are showing.
    expect(store.getCell(0, 0)?.text).toBe('hello');
  });

  it('cut + paste moves the content and clears the source', async () => {
    const { store, canvas } = setup([[0, 0, 'hello']]);
    fireEvent.keyDown(canvas, { key: 'x', ctrlKey: true });
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled());
    fireEvent.keyDown(canvas, { key: 'ArrowDown' });
    const canvas2 = document.querySelector('canvas') as HTMLCanvasElement;
    fireEvent.keyDown(canvas2, { key: 'v', ctrlKey: true });
    await waitFor(() => {
      expect(store.getCell(1, 0)?.text).toBe('hello');
      expect(store.getCell(0, 0)?.text ?? '').toBe('');
    });
  });

  it('copy keeps the source and allows repeated pastes', async () => {
    const { store, canvas } = setup([[0, 0, 'hello']]);
    fireEvent.keyDown(canvas, { key: 'c', ctrlKey: true });
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled());
    fireEvent.keyDown(canvas, { key: 'ArrowDown' });
    let c2 = document.querySelector('canvas') as HTMLCanvasElement;
    fireEvent.keyDown(c2, { key: 'v', ctrlKey: true });
    await waitFor(() => expect(store.getCell(1, 0)?.text).toBe('hello'));
    fireEvent.keyDown(c2, { key: 'ArrowDown' });
    c2 = document.querySelector('canvas') as HTMLCanvasElement;
    fireEvent.keyDown(c2, { key: 'v', ctrlKey: true });
    await waitFor(() => expect(store.getCell(2, 0)?.text).toBe('hello'));
    expect(store.getCell(0, 0)?.text).toBe('hello');
  });

  it('Escape cancels the cut session — a later paste no longer clears the source', async () => {
    const { store, canvas } = setup([[0, 0, 'hello']]);
    fireEvent.keyDown(canvas, { key: 'x', ctrlKey: true });
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled());
    fireEvent.keyDown(canvas, { key: 'Escape' });
    fireEvent.keyDown(canvas, { key: 'ArrowDown' });
    const canvas2 = document.querySelector('canvas') as HTMLCanvasElement;
    fireEvent.keyDown(canvas2, { key: 'v', ctrlKey: true });
    await waitFor(() => expect(store.getCell(1, 0)?.text).toBe('external'));
    // Session was cancelled: paste fell back to the system clipboard, source untouched.
    expect(store.getCell(0, 0)?.text).toBe('hello');
  });
});
