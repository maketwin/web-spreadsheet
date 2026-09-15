import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SpreadsheetComponent } from '../../src/components/Spreadsheet';
import { Store } from '../../src/store/Store';
import { afterEach, vi } from 'vitest';

function installCanvasContext(): void {
  const ctx: Partial<CanvasRenderingContext2D> = {
    beginPath: vi.fn(), clip: vi.fn(), fillRect: vi.fn(), fillText: vi.fn(), rect: vi.fn(),
    restore: vi.fn(), save: vi.fn(), scale: vi.fn(), setLineDash: vi.fn(), setTransform: vi.fn(), strokeRect: vi.fn(),
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

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  document.body.innerHTML = '';
});

describe('Ctrl+Enter (Excel: fill the whole selection)', () => {
  it('fills every selected cell with the typed text', () => {
    installCanvasContext();
    const store = new Store();
    render(<SpreadsheetComponent store={store} theme={false} />);
    const canvas = document.querySelector('canvas') as HTMLCanvasElement;
    installCanvasRect(canvas);

    fireEvent.keyDown(canvas, { key: 'ArrowDown', shiftKey: true }); // select A1:A2
    fireEvent.keyDown(canvas, { key: '5' });
    const input = screen.getByLabelText('Cell editor');
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });

    expect(store.getCell(0, 0)).toMatchObject({ text: '5', value: 5 });
    expect(store.getCell(1, 0)).toMatchObject({ text: '5', value: 5 });
  });

  it('shifts relative formula refs per cell (anchor at the editing cell)', () => {
    installCanvasContext();
    const store = new Store();
    render(<SpreadsheetComponent store={store} theme={false} />);
    const canvas = document.querySelector('canvas') as HTMLCanvasElement;
    installCanvasRect(canvas);

    fireEvent.keyDown(canvas, { key: 'ArrowDown', shiftKey: true }); // select A1:A2
    fireEvent.keyDown(canvas, { key: '=' });
    const input = screen.getByLabelText('Cell editor');
    fireEvent.change(input, { target: { value: '=B1' } });
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });

    expect(store.getCell(0, 0)?.formula).toBe('=B1');
    expect(store.getCell(1, 0)?.formula).toBe('=B2');
  });

  it('canvas Ctrl+Enter re-enters the active cell content across the selection', () => {
    installCanvasContext();
    const store = new Store();
    store.setCell(0, 0, { text: '9', value: 9 });
    render(<SpreadsheetComponent store={store} theme={false} />);
    const canvas = document.querySelector('canvas') as HTMLCanvasElement;
    installCanvasRect(canvas);

    fireEvent.keyDown(canvas, { key: 'ArrowRight', shiftKey: true }); // select A1:B1
    fireEvent.keyDown(canvas, { key: 'Enter', ctrlKey: true });

    expect(store.getCell(0, 1)).toMatchObject({ text: '9', value: 9 });
  });

  it('plain Enter still commits only the editing cell and moves down', () => {
    installCanvasContext();
    const store = new Store();
    render(<SpreadsheetComponent store={store} theme={false} />);
    const canvas = document.querySelector('canvas') as HTMLCanvasElement;
    installCanvasRect(canvas);

    fireEvent.keyDown(canvas, { key: 'ArrowDown', shiftKey: true });
    fireEvent.keyDown(canvas, { key: '7' });
    const input = screen.getByLabelText('Cell editor');
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(store.getCell(0, 0)).toMatchObject({ text: '7', value: 7 });
    expect(store.getCell(1, 0)).toBeUndefined();
  });
});

describe('F4 (Excel: repeat last action)', () => {
  it('repeats the last style command on the new selection', async () => {
    const { CommandManager } = await import('../../src/commands/CommandManager');
    installCanvasContext();
    const store = new Store();
    const mgr = new CommandManager(store);
    render(<SpreadsheetComponent store={store} cmdManager={mgr} theme={false} />);
    const canvas = document.querySelector('canvas') as HTMLCanvasElement;
    installCanvasRect(canvas);

    fireEvent.keyDown(canvas, { key: 'b', ctrlKey: true }); // bold A1
    fireEvent.keyDown(canvas, { key: 'ArrowRight' }); // select B1
    fireEvent.keyDown(canvas, { key: 'F4' });

    const b1 = store.getCell(0, 1);
    expect(b1?.styleId).toBeDefined();
    expect(store.getStyle(b1!.styleId!)?.bold).toBe(true);
  });
});
