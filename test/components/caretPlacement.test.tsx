import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpreadsheetComponent } from '../../src/index';
import { COL_HEADER_HEIGHT, ROW_HEADER_WIDTH } from '../../src/renderer/CanvasRenderer';
import { Store } from '../../src/store/Store';

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
    setLineDash: vi.fn(),
    setTransform: vi.fn(),
    strokeRect: vi.fn(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as CanvasRenderingContext2D);
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
}

function installCanvasRect(canvas: HTMLCanvasElement): void {
  Object.defineProperty(canvas, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ left: 0, top: 0, width: 300, height: 150, right: 300, bottom: 150, x: 0, y: 0, toJSON: () => ({}) }),
  });
}

describe('editor caret placement (Excel parity)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    document.body.innerHTML = '';
  });

  it('F2 places the caret at the end of the cell content', () => {
    installCanvasContext();
    const store = new Store();
    store.setCell(0, 0, { text: 'hello' });
    render(<SpreadsheetComponent store={store} theme={false} />);
    const canvas = document.querySelector('canvas') as HTMLCanvasElement;

    fireEvent.keyDown(canvas, { key: 'F2' });

    const editor = screen.getByLabelText('Cell editor') as HTMLTextAreaElement;
    expect(editor).toHaveValue('hello');
    expect(editor.selectionStart).toBe(5);
    expect(editor.selectionEnd).toBe(5);
  });

  it('double-click after a committed edit uses the hit caret, not position 0', () => {
    installCanvasContext();
    const store = new Store();
    render(<SpreadsheetComponent store={store} theme={false} />);
    const canvas = document.querySelector('canvas') as HTMLCanvasElement;
    installCanvasRect(canvas);

    // Type "hello" into A1, commit with Enter (selection moves to A2).
    fireEvent.keyDown(canvas, { key: 'h' });
    const editor = screen.getByLabelText('Cell editor') as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: 'hello' } });
    fireEvent.keyDown(editor, { key: 'Enter' });

    // Re-select A1, then double-click it — the caret must sit at the click
    // hit position (jsdom's deterministic mock metrics yield 1), never reset
    // to the textarea default 0 by the stale cell-key guard.
    fireEvent.mouseDown(canvas, { clientX: ROW_HEADER_WIDTH + 1, clientY: COL_HEADER_HEIGHT + 1 });
    fireEvent.doubleClick(canvas, { clientX: ROW_HEADER_WIDTH + 10, clientY: COL_HEADER_HEIGHT + 10 });

    const reopened = screen.getByLabelText('Cell editor') as HTMLTextAreaElement;
    expect(reopened).toHaveValue('hello');
    expect(reopened.selectionStart).toBe(1);
  });

  it('typing "=" opens the editor with the caret after the "="', () => {
    installCanvasContext();
    const store = new Store();
    render(<SpreadsheetComponent store={store} theme={false} />);
    const canvas = document.querySelector('canvas') as HTMLCanvasElement;

    fireEvent.keyDown(canvas, { key: '=' });

    const editor = screen.getByLabelText('Cell editor') as HTMLTextAreaElement;
    expect(editor).toHaveValue('=');
    expect(editor.selectionStart).toBe(1);
    expect(editor.selectionEnd).toBe(1);
  });

  it('re-opening the same cell after a committed edit still places the caret at the end', () => {
    installCanvasContext();
    const store = new Store();
    render(<SpreadsheetComponent store={store} theme={false} />);
    const canvas = document.querySelector('canvas') as HTMLCanvasElement;

    // Type "hello" and commit with Enter.
    fireEvent.keyDown(canvas, { key: 'h' });
    const editor = screen.getByLabelText('Cell editor') as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: 'hello' } });
    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(store.getCell(0, 0)?.text).toBe('hello');

    // Re-select A1 (Enter moved the selection to A2), then re-open the SAME
    // cell with F2 — the caret must not regress to 0.
    fireEvent.mouseDown(canvas, { clientX: ROW_HEADER_WIDTH + 1, clientY: COL_HEADER_HEIGHT + 1 });
    fireEvent.keyDown(canvas, { key: 'F2' });
    const reopened = screen.getByLabelText('Cell editor') as HTMLTextAreaElement;
    expect(reopened).toHaveValue('hello');
    expect(reopened.selectionStart).toBe(5);
    expect(reopened.selectionEnd).toBe(5);
  });
});
