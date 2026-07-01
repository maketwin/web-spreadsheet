import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FormulaEngine, Spreadsheet, SpreadsheetComponent } from '../../src/index';
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

describe('Spreadsheet', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    document.body.innerHTML = '';
    document.documentElement.removeAttribute('data-spreadsheet-theme');
  });

  it('renders the top-level component DOM', () => {
    installCanvasContext();

    render(<SpreadsheetComponent store={new Store()} theme={false} />);

    expect(screen.getByRole('toolbar', { name: 'Spreadsheet toolbar' })).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Spreadsheet sheets' })).toBeInTheDocument();
    expect(document.querySelector('canvas')).toBeInTheDocument();
  });

  it('instantiates facade and renders into root element', async () => {
    installCanvasContext();
    const root = document.createElement('div');
    root.id = 'app';
    document.body.append(root);

    const spreadsheet = new Spreadsheet('app', { data: [['A1']], theme: false });
    act(() => spreadsheet.mount());

    expect(root.querySelector('.ss-root')).toBeInTheDocument();
    expect(spreadsheet.rowCount).toBe(1);
    act(() => spreadsheet.destroy());
  });

  it('selects cells from renderer mousedown events', () => {
    installCanvasContext();
    render(<SpreadsheetComponent store={new Store()} theme={false} />);
    const target = document.querySelector('canvas') as HTMLCanvasElement;
    installCanvasRect(target);

    fireEvent.mouseDown(target, { clientX: 46 + 110, clientY: 25 + 30 });
    fireEvent.keyDown(target, { key: 'x' });

    expect(screen.getByLabelText('Cell editor')).toHaveValue('x');
  });

  it('opens the editor on Enter for the selected cell', () => {
    installCanvasContext();
    render(<SpreadsheetComponent store={new Store()} theme={false} />);
    const canvas = document.querySelector('canvas') as HTMLCanvasElement;

    fireEvent.keyDown(canvas, { key: 'Enter' });

    expect(screen.getByLabelText('Cell editor')).toBeInTheDocument();
  });

  it('typing a character writes through to the store and starts editing', () => {
    installCanvasContext();
    const store = new Store();
    render(<SpreadsheetComponent store={store} theme={false} />);
    const canvas = document.querySelector('canvas') as HTMLCanvasElement;

    fireEvent.keyDown(canvas, { key: '7' });

    expect(store.getCell(0, 0)).toMatchObject({ text: '7', value: 7 });
    expect(screen.getByLabelText('Cell editor')).toHaveValue('7');
  });

  it('commits overlay editor changes on Enter', () => {
    installCanvasContext();
    const store = new Store();
    render(<SpreadsheetComponent store={store} theme={false} />);
    fireEvent.keyDown(document.querySelector('canvas') as HTMLCanvasElement, { key: 'Enter' });
    const input = screen.getByLabelText('Cell editor');

    fireEvent.change(input, { target: { value: '42' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(store.getCell(0, 0)).toMatchObject({ text: '42', value: 42 });
  });

  it('cancels overlay editor changes on Escape', () => {
    installCanvasContext();
    const store = new Store();
    render(<SpreadsheetComponent store={store} theme={false} />);
    fireEvent.keyDown(document.querySelector('canvas') as HTMLCanvasElement, { key: 'Enter' });
    const input = screen.getByLabelText('Cell editor');

    fireEvent.change(input, { target: { value: '99' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(store.getCell(0, 0)).toBeUndefined();
    expect(screen.queryByLabelText('Cell editor')).not.toBeInTheDocument();
  });

  it('formula engine recalculates when a dependency cell changes', () => {
    installCanvasContext();
    const store = new Store();
    const formulaEngine = new FormulaEngine(store);
    render(<SpreadsheetComponent store={store} formulaEngine={formulaEngine} theme={false} />);

    act(() => store.setCell(0, 0, { text: '1', value: 1 }));
    act(() => store.setCell(0, 1, { text: '=A1' }));
    act(() => store.setCell(0, 0, { text: '5', value: 5 }));

    expect(store.getCell(0, 1)?.value).toBe(5);
  });
});
