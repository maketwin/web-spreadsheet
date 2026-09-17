import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MenuBar } from '../../../src/components/menu/MenuBar';
import { Range } from '../../../src/selection/Range';
import { Store } from '../../../src/store/Store';

/** jsdom has no canvas implementation — stub the 2D context for the print preview. */
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

describe('MenuBar', () => {
  it('renders 8 menu items', () => {
    render(<MenuBar store={new Store()} selected={Range.single(0, 0).toAddress()} selectRange={() => undefined} clearRange={() => undefined} allRange={() => undefined} />);

    expect(screen.getByText('文件(F)')).toBeInTheDocument();
    expect(screen.getByText('编辑(E)')).toBeInTheDocument();
    expect(screen.getByText('视图(V)')).toBeInTheDocument();
    expect(screen.getByText('插入(I)')).toBeInTheDocument();
    expect(screen.getByText('格式(O)')).toBeInTheDocument();
    expect(screen.getByText('数据(D)')).toBeInTheDocument();
    expect(screen.getByText('帮助(H)')).toBeInTheDocument();
  });

  it('文件 → 打印... opens the print preview dialog instead of window.print', async () => {
    const printSpy = vi.fn();
    vi.stubGlobal('print', printSpy);
    try {
      installCanvasContext();
      render(<MenuBar store={new Store()} selected={Range.single(0, 0).toAddress()} selectRange={() => undefined} clearRange={() => undefined} allRange={() => undefined} />);

      fireEvent.click(screen.getByText('文件(F)'));
      const printItem = await screen.findByText('打印...');
      fireEvent.click(printItem);

      await waitFor(() => expect(screen.getByText('打印预览')).toBeInTheDocument());
      expect(printSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
