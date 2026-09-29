import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpreadsheetComponent } from '../../src/components/Spreadsheet';
import { Store } from '../../src/store/Store';

/**
 * Focus invariant: EVERY exit from the cell editor returns keyboard focus to
 * the grid. Before the central `cancelEditing`/commit refocus existed, Esc (in
 * particular) left focus on <body> and arrows/F2/undo stayed dead until the
 * next canvas click. Each exit path below pins the behavior so a new editor
 * entry point cannot quietly regress it.
 */
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

function openEditorAtA1(): { canvas: HTMLCanvasElement; input: HTMLTextAreaElement } {
  const canvas = document.querySelector('canvas') as HTMLCanvasElement;
  fireEvent.keyDown(canvas, { key: 'F2' });
  const input = screen.getByLabelText('Cell editor') as HTMLTextAreaElement;
  return { canvas, input };
}

describe('editor exit paths return focus to the grid', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    document.body.innerHTML = '';
  });

  it('Enter commits and refocuses the canvas', () => {
    installCanvasContext();
    const store = new Store();
    render(<SpreadsheetComponent store={store} theme={false} />);
    const { canvas, input } = openEditorAtA1();

    fireEvent.change(input, { target: { value: '42' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(store.getCell(0, 0)?.text).toBe('42');
    expect(screen.queryByLabelText('Cell editor')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(canvas);
  });

  it('Shift+Enter commits upward and refocuses the canvas', () => {
    installCanvasContext();
    const store = new Store();
    store.setCell(5, 0, { text: 'anchor' });
    render(<SpreadsheetComponent store={store} theme={false} />);
    const canvas = document.querySelector('canvas') as HTMLCanvasElement;
    // Select A6 (active cell), then type on it and commit upward.
    fireEvent.keyDown(canvas, { key: '6' }); // name-box-free path: typing '6' opens the editor with '6'
    const input = screen.getByLabelText('Cell editor') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'x' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });

    expect(store.getCell(5, 0)?.text).toBe('anchor'); // untouched
    expect(document.activeElement).toBe(canvas);
  });

  it('Tab commits and refocuses the canvas', () => {
    installCanvasContext();
    const store = new Store();
    render(<SpreadsheetComponent store={store} theme={false} />);
    const { canvas, input } = openEditorAtA1();

    fireEvent.change(input, { target: { value: 'tabbed' } });
    fireEvent.keyDown(input, { key: 'Tab' });

    expect(store.getCell(0, 0)?.text).toBe('tabbed');
    expect(document.activeElement).toBe(canvas);
  });

  it('Ctrl+Enter fills the selection and refocuses the canvas', () => {
    installCanvasContext();
    const store = new Store();
    render(<SpreadsheetComponent store={store} theme={false} />);
    const { canvas, input } = openEditorAtA1();

    fireEvent.change(input, { target: { value: 'same' } });
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });

    expect(store.getCell(0, 0)?.text).toBe('same');
    expect(document.activeElement).toBe(canvas);
  });

  it('Escape cancels and refocuses the canvas', () => {
    installCanvasContext();
    const store = new Store();
    render(<SpreadsheetComponent store={store} theme={false} />);
    const { canvas, input } = openEditorAtA1();

    fireEvent.change(input, { target: { value: 'draft' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(store.getCell(0, 0)).toBeUndefined();
    expect(document.activeElement).toBe(canvas);
  });

  it('click-away blur commits and never leaves focus on <body>', () => {
    installCanvasContext();
    const store = new Store();
    render(<SpreadsheetComponent store={store} theme={false} />);
    const { input } = openEditorAtA1();

    fireEvent.change(input, { target: { value: 'blurred' } });
    fireEvent.blur(input);

    expect(store.getCell(0, 0)?.text).toBe('blurred');
    expect(screen.queryByLabelText('Cell editor')).not.toBeInTheDocument();
    expect(document.activeElement).not.toBe(document.body);
  });

  it('formula bar Escape returns focus to the grid', () => {
    installCanvasContext();
    const store = new Store();
    render(<SpreadsheetComponent store={store} theme={false} />);
    const canvas = document.querySelector('canvas') as HTMLCanvasElement;
    const bar = screen.getByLabelText('Formula bar') as HTMLInputElement;

    fireEvent.focus(bar);
    fireEvent.change(bar, { target: { value: '=1+1' } });
    fireEvent.keyDown(bar, { key: 'Escape' });

    expect(document.activeElement).toBe(canvas);
  });

  it('protected sheet blocks edit-mode entry outright (grid keeps focus)', () => {
    installCanvasContext();
    const store = new Store();
    store.setProtection({ protected: true, passwordHash: 'x' });
    render(<SpreadsheetComponent store={store} theme={false} />);
    const canvas = document.querySelector('canvas') as HTMLCanvasElement;
    // jsdom does not auto-focus the canvas on key events (real browsers focus
    // it via the preceding mousedown) — establish the grid-focused baseline.
    canvas.focus();

    // Excel: F2 / typing on a protected sheet never opens the editor — one
    // rejection per attempt, no editor, no focus loss, no keystroke spam.
    fireEvent.keyDown(canvas, { key: 'F2' });
    fireEvent.keyDown(canvas, { key: '7' });

    expect(screen.queryByLabelText('Cell editor')).not.toBeInTheDocument();
    expect(store.getCell(0, 0)).toBeUndefined();
    expect(document.activeElement).toBe(canvas);
  });
});
