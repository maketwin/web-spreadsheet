import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MoveOrCopySheetDialog } from '../../../../src/components/menu/dialogs/MoveOrCopySheetDialog';
import type { SheetInfo } from '../../../../src/store/Store';

function mockMatchMedia(): void {
  vi.stubGlobal('matchMedia', (query: string): MediaQueryList => ({
    matches: false, media: query, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

const sheets: readonly SheetInfo[] = [
  { id: 's1', name: 'Sheet1' },
  { id: 's2', name: '数据表' },
];

describe('MoveOrCopySheetDialog', () => {
  beforeEach(() => { mockMatchMedia(); });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('lists every sheet plus the move-to-end option', () => {
    render(<MoveOrCopySheetDialog open sheetId="s1" sheets={sheets} onCancel={() => {}} onSubmit={() => {}} />);
    expect(screen.getByText('移动或复制工作表')).toBeInTheDocument();
    expect(screen.getByText('Sheet1')).toBeInTheDocument();
    expect(screen.getByText('数据表')).toBeInTheDocument();
    expect(screen.getByText('（移到最后）')).toBeInTheDocument();
  });

  it('确定 submits the default position (end, no copy)', async () => {
    const onSubmit = vi.fn();
    render(<MoveOrCopySheetDialog open sheetId="s1" sheets={sheets} onCancel={() => {}} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: '确 定' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({ beforeSheetId: 'end', createCopy: false });
  });

  it('picking a sheet and checking 建立副本 submits both values', async () => {
    const onSubmit = vi.fn();
    render(<MoveOrCopySheetDialog open sheetId="s1" sheets={sheets} onCancel={() => {}} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole('radio', { name: '数据表' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '建立副本' }));
    fireEvent.click(screen.getByRole('button', { name: '确 定' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({ beforeSheetId: 's2', createCopy: true });
  });

  it('取消 invokes onCancel', () => {
    const onCancel = vi.fn();
    render(<MoveOrCopySheetDialog open sheetId="s1" sheets={sheets} onCancel={onCancel} onSubmit={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: '取 消' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
