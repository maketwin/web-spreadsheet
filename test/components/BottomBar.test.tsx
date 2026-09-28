import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BottomBar } from '../../src/components/BottomBar';

/** jsdom has no PointerEvent — patch pointer fields onto a MouseEvent. */
function touchPointer(type: string, x = 10, y = 10): PointerEvent {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperty(ev, 'pointerId', { value: 1 });
  Object.defineProperty(ev, 'pointerType', { value: 'touch' });
  return ev as unknown as PointerEvent;
}

describe('BottomBar', () => {
  afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

  it('renders sheet switch buttons', () => {
    render(<BottomBar sheets={['Sheet1', 'Sheet2']} activeSheet="Sheet2" />);

    expect(screen.getByRole('tab', { name: 'Sheet1' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Sheet2' })).toHaveAttribute('aria-selected', 'true');
  });

  it('a long-press on a tab opens its context menu (mobile right-click)', () => {
    vi.useFakeTimers();
    const onRename = vi.fn();
    render(<BottomBar sheets={['Sheet1']} activeSheetId="s1" onRenameSheet={onRename} />);
    const tab = screen.getByRole('tab', { name: 'Sheet1' });

    fireEvent(tab, touchPointer('pointerdown', 20, 30));
    act(() => { vi.advanceTimersByTime(600); });
    // The synthetic contextmenu ran the same handler a right-click uses.
    expect(screen.getByRole('menu')).toBeInTheDocument();

    // Menu action still works from the long-press path.
    fireEvent.click(screen.getByText('重命名'));
    expect(onRename).toHaveBeenCalledWith('Sheet1');
  });

  it('the click trailing a long-press neither switches sheets nor closes the menu', () => {
    vi.useFakeTimers();
    const onSheetChange = vi.fn();
    render(<BottomBar sheets={['Sheet1']} activeSheetId="s1" onSheetChange={onSheetChange} />);
    const tab = screen.getByRole('tab', { name: 'Sheet1' });

    fireEvent(tab, touchPointer('pointerdown', 20, 30));
    act(() => { vi.advanceTimersByTime(600); });
    expect(screen.getByRole('menu')).toBeInTheDocument();

    // The tap-click the browser synthesizes on finger lift must be swallowed.
    fireEvent.click(tab);
    expect(onSheetChange).not.toHaveBeenCalled();
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('a quick touch tap still switches sheets', () => {
    const onSheetChange = vi.fn();
    render(<BottomBar sheets={['Sheet1']} activeSheetId="s1" onSheetChange={onSheetChange} />);
    const tab = screen.getByRole('tab', { name: 'Sheet1' });

    fireEvent(tab, touchPointer('pointerdown', 20, 30));
    fireEvent(tab, touchPointer('pointerup', 20, 30));
    fireEvent.click(tab);
    expect(onSheetChange).toHaveBeenCalledWith('Sheet1');
  });
});
