import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PrintPreview } from '../../src/components/PrintPreview';
import { Store } from '../../src/store/Store';

/** jsdom has no canvas implementation — stub the 2D context (CanvasRenderer.test pattern). */
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
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
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

describe('PrintPreview', () => {
  it('renders settings and a page thumbnail per printed page', () => {
    installCanvasContext();
    render(<PrintPreview open onCancel={() => undefined} store={makeStore()} />);

    expect(screen.getByText('打印预览')).toBeInTheDocument();
    expect(screen.getByText('第 1 页，共 1 页')).toBeInTheDocument();
    expect(screen.getByLabelText('纸张')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '适合宽度' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '横向' })).toBeInTheDocument();
    // antd Modal renders in a body portal — canvases are appended imperatively.
    expect(document.body.querySelectorAll('canvas')).toHaveLength(1);
  });

  it('re-paginating after switching to landscape still renders pages', () => {
    installCanvasContext();
    render(<PrintPreview open onCancel={() => undefined} store={makeStore()} />);

    fireEvent.click(screen.getByRole('radio', { name: '横向' }));
    expect(screen.getByText('第 1 页，共 1 页')).toBeInTheDocument();
    expect(document.body.querySelectorAll('canvas')).toHaveLength(1);
  });

  it('renders nothing when closed', () => {
    installCanvasContext();
    render(<PrintPreview open={false} onCancel={() => undefined} store={new Store()} />);
    expect(document.body.querySelectorAll('canvas')).toHaveLength(0);
    expect(screen.queryByText('打印预览')).not.toBeInTheDocument();
  });
});
