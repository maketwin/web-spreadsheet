import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BottomBar } from '../../src/components/BottomBar';
import { Store } from '../../src/store/Store';

describe('SheetTabs (BottomBar)', () => {
  it('renders sheet tabs and add button', () => {
    const store = new Store();
    const sheets = store.getSheets();

    render(<BottomBar sheets={sheets} activeSheetId="sheet-1" onSheetChange={vi.fn()} onAddSheet={vi.fn()} />);

    expect(screen.getByText('Sheet1')).toBeTruthy();
    expect(screen.getByLabelText('Add sheet')).toBeTruthy();
  });

  it('clicks tab to activate sheet', () => {
    const store = new Store();
    const sheet2Id = store.addSheet('Sheet2');
    const sheets = store.getSheets();
    const onChange = vi.fn();

    render(<BottomBar sheets={sheets} activeSheetId="sheet-1" onSheetChange={onChange} onAddSheet={vi.fn()} />);

    fireEvent.click(screen.getByText('Sheet2'));
    expect(onChange).toHaveBeenCalledWith(sheet2Id);
  });

  it('clicks add button to add sheet', () => {
    const onAdd = vi.fn();

    render(<BottomBar sheets={[{ id: 'sheet-1', name: 'Sheet1' }]} activeSheetId="sheet-1" onSheetChange={vi.fn()} onAddSheet={onAdd} />);

    fireEvent.click(screen.getByLabelText('Add sheet'));
    expect(onAdd).toHaveBeenCalled();
  });

  it('right-clicks tab to open rename/delete menu', () => {
    const onDelete = vi.fn();
    const onRename = vi.fn();
    const sheets = [{ id: 'sheet-1', name: 'Sheet1' }, { id: 'sheet-2', name: 'Sheet2' }];

    render(<BottomBar sheets={sheets} activeSheetId="sheet-1" onSheetChange={vi.fn()} onAddSheet={vi.fn()} onRenameSheet={onRename} onDeleteSheet={onDelete} />);

    fireEvent.contextMenu(screen.getByText('Sheet2'));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: '删除' }).querySelector('button')!);
    expect(onDelete).toHaveBeenCalledWith('sheet-2');
    expect(onRename).not.toHaveBeenCalled();
  });

  it('Store addSheet creates auto-named sheet', () => {
    const store = new Store();

    const id2 = store.addSheet();
    expect(store.getSheetData(id2)).toBeDefined();

    const sheets = store.getSheets();
    expect(sheets.length).toBe(2);
    expect(sheets[1]?.name).toBe('Sheet2');
  });

  it('Store deleteSheet removes sheet', () => {
    const store = new Store();
    const id2 = store.addSheet('Sheet2');

    store.deleteSheet(id2);
    expect(store.getSheets().length).toBe(1);
  });

  it('Store renameSheet changes name', () => {
    const store = new Store();

    store.renameSheet('sheet-1', 'MySheet');
    expect(store.getSheets()[0]?.name).toBe('MySheet');
  });

  it('Store activateSheet switches active', () => {
    const store = new Store();
    const id2 = store.addSheet('Sheet2');

    store.activateSheet(id2);
    expect(store.getActiveSheetId()).toBe(id2);

    store.activateSheet('sheet-1');
    expect(store.getActiveSheetId()).toBe('sheet-1');
  });

  it('drags a tab onto another to reorder', () => {
    const onMove = vi.fn();
    const sheets = [{ id: 'sheet-1', name: 'Sheet1' }, { id: 'sheet-2', name: 'Sheet2' }];
    render(<BottomBar sheets={sheets} activeSheetId="sheet-1" onSheetChange={vi.fn()} onAddSheet={vi.fn()} onMoveSheet={onMove} />);
    fireEvent.dragStart(screen.getByText('Sheet1'), { dataTransfer: { setData: vi.fn(), effectAllowed: 'move' } });
    fireEvent.drop(screen.getByText('Sheet2'), { dataTransfer: { getData: () => 'sheet-1', dropEffect: 'move' }, preventDefault: vi.fn() });
    expect(onMove).toHaveBeenCalledWith('sheet-1', 1);
  });

  it('sets sheet tab color from the context menu', () => {
    const onColor = vi.fn();
    render(<BottomBar sheets={[{ id: 'sheet-1', name: 'Sheet1' }]} activeSheetId="sheet-1" onSheetChange={vi.fn()} onAddSheet={vi.fn()} onSheetColor={onColor} />);
    fireEvent.contextMenu(screen.getByText('Sheet1'));
    fireEvent.click(screen.getByLabelText('Sheet color #217346'));
    expect(onColor).toHaveBeenCalledWith('sheet-1', '#217346');
  });

  it('Store moveSheet and setSheetColor persist through serialize', () => {
    const store = new Store();
    const id2 = store.addSheet('Sheet2');
    store.setSheetColor(id2, '#ed7d31');
    store.moveSheet(id2, 0);
    expect(store.getSheets()[0]?.id).toBe(id2);
    expect(store.getSheets()[0]?.color).toBe('#ed7d31');
    const round = Store.deserialize(store.serialize());
    expect(round.getSheets()[0]?.color).toBe('#ed7d31');
    expect(round.getSheets()[0]?.name).toBe('Sheet2');
  });
});
