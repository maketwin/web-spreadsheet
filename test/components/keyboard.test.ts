import { describe, expect, it, vi } from 'vitest';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { handleCanvasKeyDown, handleEndMode } from '../../src/components/keyboard';
import { cellSelection } from '../../src/selection/Selection';
import { Store } from '../../src/store/Store';
import type { Command } from '../../src/commands/Command';

/**
 * The keyboard dispatch layer is dependency-injected (KeyboardContext), so the
 * key → action mapping is asserted directly on the callbacks — no canvas, no
 * React tree. Spreadsheet-level behaviors (editor open, clipboard, menus)
 * stay covered by the component tests; this file pins WHICH action each key
 * gesture routes to.
 */
type Gesture = Partial<Pick<ReactKeyboardEvent<HTMLCanvasElement>, 'key' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey'>>;

function fire(store: Store, gesture: Gesture): Record<string, number> {
  const calls: Record<string, number> = {};
  const bump = (k: string): void => { calls[k] = (calls[k] ?? 0) + 1; };
  const event = {
    ...gesture,
    currentTarget: { clientHeight: 600 } as HTMLCanvasElement,
    preventDefault: () => bump('preventDefault'),
  } as unknown as ReactKeyboardEvent<HTMLCanvasElement>;
  handleCanvasKeyDown(event, cellSelection(5, 2), {
    store,
    cmdManager: undefined,
    startEditing: (cell, value, editMode) => { bump(`edit:${cell.r},${cell.c}:${value ?? ''}:${editMode === true}`); },
    selectSelection: () => bump('selectSelection'),
    selectRange: () => bump('selectRange'),
    setView: () => bump('setView'),
    setFindDialog: () => bump('setFindDialog'),
    runClipboard: (type) => bump(`clipboard_${type}`),
    clearClipboardSession: () => { bump('clearClipboard'); return true; },
    execCmd: (cmd: Command) => bump(`cmd:${cmd.constructor.name}`),
    frozenRows: 0,
    frozenCols: 0,
    zoom: 100,
  });
  return calls;
}

const storeWithData = (): Store => {
  const store = new Store();
  for (let i = 0; i < 8; i += 1) store.setCell(i, 2, { text: `v${i}` });
  return store;
};

describe('handleCanvasKeyDown dispatch', () => {
  it('ArrowDown routes a plain move through selectRange', () => {
    const calls = fire(storeWithData(), { key: 'ArrowDown' });
    expect(calls.selectRange).toBe(1);
    expect(calls.selectSelection).toBeUndefined();
  });

  it('Shift+ArrowDown extends the selection instead of moving it', () => {
    const calls = fire(storeWithData(), { key: 'ArrowDown', shiftKey: true });
    expect(calls.selectSelection).toBe(1);
    expect(calls.selectRange).toBeUndefined();
  });

  it('Ctrl+ArrowDown routes to the data-region edge (moveEdge → selectRange)', () => {
    const calls = fire(storeWithData(), { key: 'ArrowDown', ctrlKey: true });
    expect(calls.selectRange).toBe(1);
  });

  it('Ctrl+Home jumps (jump action) even with content far away', () => {
    const store = storeWithData();
    store.setCell(30, 10, { text: 'far' });
    const calls = fire(store, { key: 'Home', ctrlKey: true });
    expect(calls.selectRange).toBe(1);
  });

  it('F2 opens the editor in edit mode at the selection anchor', () => {
    const calls = fire(storeWithData(), { key: 'F2' });
    expect(calls['edit:5,2::true']).toBe(1);
  });

  it('a printable key opens the editor in enter mode seeded with the character', () => {
    const calls = fire(storeWithData(), { key: '7' });
    expect(calls['edit:5,2:7:false']).toBe(1);
  });

  it('Delete clears the selected range content', () => {
    const store = storeWithData();
    const calls = fire(store, { key: 'Delete' });
    expect(calls.preventDefault).toBe(1);
    expect(store.getCell(5, 2)?.text).toBe('');
  });

  it('Ctrl+X / Ctrl+V route to the clipboard session (Ctrl+C is owned by the browser copy event)', () => {
    expect(fire(storeWithData(), { key: 'x', ctrlKey: true }).clipboard_cut).toBe(1);
    expect(fire(storeWithData(), { key: 'v', ctrlKey: true }).clipboard_paste).toBe(1);
  });

  it('Ctrl+Z routes through the menu shortcut (undo on the command manager)', () => {
    const store = storeWithData();
    const undo = vi.fn();
    const event = { key: 'z', ctrlKey: true, preventDefault: () => undefined, currentTarget: {} } as unknown as ReactKeyboardEvent<HTMLCanvasElement>;
    handleCanvasKeyDown(event, cellSelection(5, 2), {
      store,
      cmdManager: { undo, redo: vi.fn(), getLastExecuted: () => undefined } as unknown as Parameters<typeof handleCanvasKeyDown>[2]['cmdManager'],
      startEditing: () => {}, selectSelection: () => {}, selectRange: () => {},
      setView: () => {}, setFindDialog: () => {}, runClipboard: () => {}, clearClipboardSession: () => true,
      execCmd: () => {}, frozenRows: 0, frozenCols: 0, zoom: 100,
    });
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+; inserts the current date as cell text', () => {
    const store = storeWithData();
    fire(store, { key: ';', ctrlKey: true });
    const now = new Date();
    expect(store.getCell(5, 2)?.text).toBe(`${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()}`);
  });

  it('Escape clears the clipboard session and never changes the selection', () => {
    const calls = fire(storeWithData(), { key: 'Escape' });
    expect(calls.clearClipboard).toBe(1);
    expect(calls.selectRange).toBeUndefined();
  });

  it('Alt+= opens the editor with the AutoSum formula (column above)', () => {
    const store = storeWithData();
    store.setCell(4, 2, { text: '10' });
    store.setCell(3, 2, { text: '20' });
    const calls = fire(store, { key: '=', altKey: true });
    expect(calls['edit:5,2:=SUM(C4:C5):true']).toBe(1);
  });

  it('Ctrl+D fills down (FillRange command)', () => {
    const calls = fire(storeWithData(), { key: 'd', ctrlKey: true });
    expect(Object.keys(calls).some((k) => k.startsWith('cmd:'))).toBe(true);
  });

  it('Ctrl+Space selects the column, Shift+Space the row', () => {
    expect(fire(storeWithData(), { key: ' ', ctrlKey: true }).selectSelection).toBe(1);
    expect(fire(storeWithData(), { key: ' ', shiftKey: true }).selectSelection).toBe(1);
  });
});

describe('handleEndMode', () => {
  const mkEvent = (key: string): ReactKeyboardEvent<HTMLCanvasElement> =>
    ({ key, preventDefault: () => undefined, ctrlKey: false, metaKey: false, shiftKey: false }) as unknown as ReactKeyboardEvent<HTMLCanvasElement>;

  it('End arms End mode; the next arrow consumes it and jumps to the edge', () => {
    const store = storeWithData();
    const endMode = { current: false };
    const selectRange = vi.fn();
    expect(handleEndMode(mkEvent('End'), cellSelection(1, 2), store, endMode, vi.fn(), selectRange)).toBe(true);
    expect(endMode.current).toBe(true);
    expect(selectRange).not.toHaveBeenCalled();

    expect(handleEndMode(mkEvent('ArrowDown'), cellSelection(1, 2), store, endMode, vi.fn(), selectRange)).toBe(true);
    expect(endMode.current).toBe(false);
    expect(selectRange).toHaveBeenCalledTimes(1);
  });

  it('a non-arrow key disarms End mode without consuming', () => {
    const store = storeWithData();
    const endMode = { current: true };
    expect(handleEndMode(mkEvent('x'), cellSelection(1, 2), store, endMode, vi.fn(), vi.fn())).toBe(false);
    expect(endMode.current).toBe(false);
  });
});
