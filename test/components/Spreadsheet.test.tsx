import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Spreadsheet, SpreadsheetComponent } from '../../src/index';
import { Store } from '../../src/store/Store';

function installCanvasContext(): void {
  const ctx: Partial<CanvasRenderingContext2D> = {
    beginPath: vi.fn(),
    clip: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    strokeRect: vi.fn(),
    rect: vi.fn(),
    restore: vi.fn(),
    save: vi.fn(),
    scale: vi.fn(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    // Vitest jsdom has no real canvas context; this mock implements the methods used by CanvasRenderer.
    ctx as CanvasRenderingContext2D,
  );
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
}

describe('Spreadsheet', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    document.body.innerHTML = '';
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
});
