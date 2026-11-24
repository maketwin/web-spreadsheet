import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PrintPreview } from '../../src/components/PrintPreview';
import { Store } from '../../src/store/Store';

/** jsdom has no canvas implementation — stub the 2D context (CanvasRenderer.test pattern)
 * and toDataURL (the preview's async render pre-encodes every page as a PNG). */
function installCanvasContext(): void {
  const ctx = {
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
    setLineDash: vi.fn(),
    setTransform: vi.fn(),
    stroke: vi.fn(),
    strokeRect: vi.fn(),
    drawImage: vi.fn(),
    clearRect: vi.fn(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,x');
}

afterEach(() => {
  vi.restoreAllMocks();
});

function makeStore(): Store {
  const store = new Store();
  store.setCell(0, 0, { text: '产品' });
  store.setCell(1, 0, { text: 'A' });
  return store;
}

/** One tall column (100 rows): fitWidth keeps one page width and never
 * enlarges (Excel), so the rows split into 3 pages portrait / 4 pages
 * landscape — the preview renders across several frames and
 * re-pagination changes the count. */
function makeWideStore(): Store {
  const store = new Store();
  for (let r = 0; r < 100; r += 1) store.setCell(r, 0, { text: `r${r}` });
  return store;
}

describe('PrintPreview', () => {
  it('renders settings and a page thumbnail per printed page', async () => {
    installCanvasContext();
    render(<PrintPreview open onCancel={() => undefined} store={makeStore()} />);

    expect(screen.getByText('打印预览')).toBeInTheDocument();
    expect(screen.getByLabelText('纸张')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '适合宽度' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '横向' })).toBeInTheDocument();
    // Rendering is async — the thumbnail (and its caption) appears once painted.
    expect(await screen.findByText('第 1 页，共 1 页')).toBeInTheDocument();
    // antd Modal renders in a body portal — canvases are appended imperatively.
    expect(document.body.querySelectorAll('canvas')).toHaveLength(1);
  });

  it('disables print/export while rendering, shows progress, then enables with the page count', async () => {
    installCanvasContext();
    render(<PrintPreview open onCancel={() => undefined} store={makeWideStore()} />);

    // First page paints synchronously in the render effect; the rest wait for frames.
    expect(screen.getByText(/正在渲染第 \d+ \/ \d+ 页/)).toBeInTheDocument();
    const printButton = screen.getByRole('button', { name: /打印/ });
    const pdfButton = screen.getByRole('button', { name: /导出 PDF/ });
    expect(printButton).toBeDisabled();
    expect(pdfButton).toBeDisabled();

    await waitFor(() => expect(printButton).toBeEnabled());
    expect(pdfButton).toBeEnabled();
    // Total page count is visible on the last thumbnail's caption.
    expect(screen.getByText('第 3 页，共 3 页')).toBeInTheDocument();
    expect(screen.queryByText(/正在渲染/)).not.toBeInTheDocument();
    expect(document.body.querySelectorAll('canvas')).toHaveLength(3);
  });

  it('re-paginating after switching to landscape re-renders with the new page count', async () => {
    installCanvasContext();
    render(<PrintPreview open onCancel={() => undefined} store={makeWideStore()} />);
    await waitFor(() => expect(document.body.querySelectorAll('canvas')).toHaveLength(3));

    fireEvent.click(screen.getByRole('radio', { name: '横向' }));
    await waitFor(() => expect(document.body.querySelectorAll('canvas')).toHaveLength(4));
    expect(screen.getByText('第 4 页，共 4 页')).toBeInTheDocument();
  });

  it('print clicks through once rendering finished', async () => {
    installCanvasContext();
    const printSpy = vi.fn();
    vi.stubGlobal('print', printSpy);
    const onCancel = vi.fn();
    render(<PrintPreview open onCancel={onCancel} store={makeStore()} />);
    const printButton = await waitFor(() => {
      const button = screen.getByRole('button', { name: /打印/ });
      expect(button).toBeEnabled();
      return button;
    });
    fireEvent.click(printButton);
    expect(printSpy).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('renders nothing when closed', () => {
    installCanvasContext();
    render(<PrintPreview open={false} onCancel={() => undefined} store={new Store()} />);
    expect(document.body.querySelectorAll('canvas')).toHaveLength(0);
    expect(screen.queryByText('打印预览')).not.toBeInTheDocument();
  });
});
