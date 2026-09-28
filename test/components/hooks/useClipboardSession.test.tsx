import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RefObject } from 'react';
import { message } from 'antd';
import { useClipboardSession } from '../../../src/components/hooks/useClipboardSession';
import { CommandManager } from '../../../src/commands/CommandManager';
import { EventBus } from '../../../src/events/EventBus';
import { Store } from '../../../src/store/Store';
import { cellSelection, type Selection } from '../../../src/selection/Selection';
import type { CanvasRenderer } from '../../../src/renderer/CanvasRenderer';
import type { RangeAddress } from '../../../src/selection/Range';
import { DEFAULT_PASTE_SPECIAL } from '../../../src/clipboard/pasteSpecial';

function installClipboard(readText: string): void {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined), readText: vi.fn().mockResolvedValue(readText) },
  });
}

function setupStore(cells: Array<[number, number, string]> = []): { store: Store; cmdManager: CommandManager } {
  const store = new Store();
  for (const [r, c, text] of cells) store.setCell(r, c, { text });
  return { store, cmdManager: new CommandManager(store, new EventBus()) };
}

function setupHook(store: Store, cmdManager: CommandManager, selection: Selection, multi: RangeAddress[] = []) {
  const renderer = { setClipboardRange: vi.fn() };
  const rendererRef = { current: renderer as unknown as CanvasRenderer } as RefObject<CanvasRenderer | null>;
  const selectedRef = { current: selection } as RefObject<Selection | null>;
  const multiRef = { current: multi } as RefObject<readonly RangeAddress[]>;
  const hook = renderHook(() => useClipboardSession(store, cmdManager, rendererRef, selectedRef, multiRef));
  return { hook, renderer, selectedRef, multiRef };
}

const A1: RangeAddress = { r1: 0, c1: 0, r2: 0, c2: 0 };

describe('useClipboardSession', () => {
  beforeEach(() => { installClipboard('external'); });
  afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });

  it('copy marks a session (marching ants) without touching the source', async () => {
    const { store, cmdManager } = setupStore([[0, 0, 'hello']]);
    const { hook, renderer } = setupHook(store, cmdManager, cellSelection(0, 0));
    await act(async () => { await hook.result.current.runClipboard('copy', A1); });
    const session = hook.result.current.clipboardSession.current;
    expect(session?.type).toBe('copy');
    expect(session?.range).toEqual(A1);
    expect(session?.cells[0][0]?.text).toBe('hello');
    expect(renderer.setClipboardRange).toHaveBeenCalledWith(A1);
    expect(store.getCell(0, 0)?.text).toBe('hello');
  });

  it('clearClipboardSession reports whether a session existed and clears the ants', async () => {
    const { store, cmdManager } = setupStore([[0, 0, 'x']]);
    const { hook, renderer } = setupHook(store, cmdManager, cellSelection(0, 0));
    expect(hook.result.current.clearClipboardSession()).toBe(false);
    await act(async () => { await hook.result.current.runClipboard('copy', A1); });
    expect(hook.result.current.clearClipboardSession()).toBe(true);
    expect(hook.result.current.clipboardSession.current).toBeNull();
    expect(renderer.setClipboardRange).toHaveBeenLastCalledWith(undefined);
    expect(hook.result.current.clearClipboardSession()).toBe(false);
  });

  it('cut + paste moves the content, clears the source, ends the session — one undo step', async () => {
    const { store, cmdManager } = setupStore([[0, 0, 'hello']]);
    const { hook } = setupHook(store, cmdManager, cellSelection(0, 0));
    await act(async () => { await hook.result.current.runClipboard('cut', A1); });
    expect(store.getCell(0, 0)?.text).toBe('hello'); // source survives while ants show
    await act(async () => { await hook.result.current.runClipboard('paste', { r1: 1, c1: 0, r2: 1, c2: 0 }); });
    expect(store.getCell(1, 0)?.text).toBe('hello');
    expect(store.getCell(0, 0)?.text ?? '').toBe('');
    expect(hook.result.current.clipboardSession.current).toBeNull();
    cmdManager.undo();
    expect(store.getCell(0, 0)?.text).toBe('hello');
    expect(store.getCell(1, 0)?.text ?? '').toBe('');
  });

  it('a copy session allows repeated pastes', async () => {
    const { store, cmdManager } = setupStore([[0, 0, 'hi']]);
    const { hook } = setupHook(store, cmdManager, cellSelection(0, 0));
    await act(async () => { await hook.result.current.runClipboard('copy', A1); });
    await act(async () => { await hook.result.current.runClipboard('paste', { r1: 0, c1: 1, r2: 0, c2: 1 }); });
    await act(async () => { await hook.result.current.runClipboard('paste', { r1: 0, c1: 2, r2: 0, c2: 2 }); });
    expect(store.getCell(0, 1)?.text).toBe('hi');
    expect(store.getCell(0, 2)?.text).toBe('hi');
    expect(store.getCell(0, 0)?.text).toBe('hi');
  });

  it('paste without a session falls back to the system clipboard text', async () => {
    const { store, cmdManager } = setupStore();
    const { hook } = setupHook(store, cmdManager, cellSelection(0, 0));
    await act(async () => { await hook.result.current.runClipboard('paste', A1); });
    expect(store.getCell(0, 0)?.text).toBe('external');
  });

  it('runCtxClipboard("clear") clears the current selection', () => {
    const { store, cmdManager } = setupStore([[2, 1, 'gone']]);
    const { hook } = setupHook(store, cmdManager, cellSelection(2, 1));
    act(() => { hook.result.current.runCtxClipboard('clear'); });
    expect(store.getCell(2, 1)?.text ?? '').toBe('');
  });

  it('runCtxClipboard("cut"/"copy") dispatch to the selection range', async () => {
    const { store, cmdManager } = setupStore([[0, 0, 'ctx']]);
    const { hook } = setupHook(store, cmdManager, cellSelection(0, 0));
    await act(async () => { hook.result.current.runCtxClipboard('copy'); });
    expect(hook.result.current.clipboardSession.current?.range).toEqual(A1);
  });

  it('multi-area copy combines aligned ranges into one session', async () => {
    const { store, cmdManager } = setupStore([[0, 0, 'a'], [0, 2, 'b']]);
    const extras: RangeAddress[] = [{ r1: 0, c1: 2, r2: 0, c2: 2 }];
    const { hook } = setupHook(store, cmdManager, cellSelection(0, 0), extras);
    await act(async () => { await hook.result.current.runClipboard('copy', A1); });
    const session = hook.result.current.clipboardSession.current;
    expect(session?.range).toEqual({ r1: 0, c1: 0, r2: 0, c2: 2 });
    expect(session?.cells[0][0]?.text).toBe('a');
  });

  it('multi-area copy with misaligned ranges is refused with a warning and no session', async () => {
    const warn = vi.spyOn(message, 'warning').mockImplementation(() => undefined);
    const { store, cmdManager } = setupStore([[0, 0, 'a'], [5, 5, 'b']]);
    // Two single cells in different rows AND columns cannot line up.
    const extras: RangeAddress[] = [{ r1: 5, c1: 5, r2: 5, c2: 5 }];
    const { hook } = setupHook(store, cmdManager, cellSelection(0, 0), extras);
    await act(async () => { await hook.result.current.runClipboard('copy', A1); });
    expect(warn).toHaveBeenCalled();
    expect(hook.result.current.clipboardSession.current).toBeNull();
  });

  it('paste special with a session pastes values at the selection', async () => {
    const { store, cmdManager } = setupStore([[0, 0, '5']]);
    const { hook } = setupHook(store, cmdManager, cellSelection(0, 1)); // B1
    await act(async () => { await hook.result.current.runClipboard('copy', A1); });
    await act(async () => { await hook.result.current.applyPasteSpecial({ ...DEFAULT_PASTE_SPECIAL, mode: 'values' }); });
    expect(store.getCell(0, 1)?.text).toBe('5');
    expect(hook.result.current.pasteSpecialOpen).toBe(false);
  });

  it('paste special without a session reads the system clipboard', async () => {
    const { store, cmdManager } = setupStore();
    const { hook } = setupHook(store, cmdManager, cellSelection(0, 0));
    await act(async () => { await hook.result.current.applyPasteSpecial(DEFAULT_PASTE_SPECIAL); });
    expect(store.getCell(0, 0)?.text).toBe('external');
  });

  it('a cut session ends on paste special and clears the source in the same step', async () => {
    const { store, cmdManager } = setupStore([[0, 0, 'mv']]);
    const { hook } = setupHook(store, cmdManager, cellSelection(0, 1)); // paste target B1
    await act(async () => { await hook.result.current.runClipboard('cut', A1); });
    await act(async () => { await hook.result.current.applyPasteSpecial(DEFAULT_PASTE_SPECIAL); });
    expect(store.getCell(0, 1)?.text).toBe('mv');
    expect(store.getCell(0, 0)?.text ?? '').toBe('');
    expect(hook.result.current.clipboardSession.current).toBeNull();
    cmdManager.undo();
    expect(store.getCell(0, 0)?.text).toBe('mv');
    expect(store.getCell(0, 1)?.text ?? '').toBe('');
  });

  it('formats-only paste special does not clear a cut source', async () => {
    const { store, cmdManager } = setupStore([[0, 0, 'keep']]);
    const { hook } = setupHook(store, cmdManager, cellSelection(0, 1));
    await act(async () => { await hook.result.current.runClipboard('cut', A1); });
    await act(async () => { await hook.result.current.applyPasteSpecial({ ...DEFAULT_PASTE_SPECIAL, mode: 'formats' }); });
    expect(store.getCell(0, 0)?.text).toBe('keep'); // source survives
  });
});
