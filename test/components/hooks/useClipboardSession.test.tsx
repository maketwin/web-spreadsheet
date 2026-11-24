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
    expect(session?.cells[0]?.[0]?.text).toBe('hello');
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
    expect(session?.cells[0]?.[0]?.text).toBe('a');
  });

  it('multi-area copy with misaligned ranges is refused with a warning and no session', async () => {
    const warn = vi.spyOn(message, 'warning').mockImplementation(() => ({}) as ReturnType<typeof message.warning>);
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

  // Style ids are sheet-local, and a session outlives a sheet switch: a paste
  // on another sheet used to carry the source sheet's ids over, and a cut
  // cleared its source coordinates on the *target* sheet.
  describe('across sheets', () => {
    const source = 'sheet-1';

    it('a pasted style is registered on the target sheet, whatever that sheet has under the same id', async () => {
      const { store, cmdManager } = setupStore();
      store.setStyle('shared-id', { bold: true });
      store.setCell(0, 0, { text: 'styled', styleId: 'shared-id' });
      const other = store.addSheet('Other');
      store.setStyle('shared-id', { italic: true }, other);
      store.activateSheet(source); // addSheet activates the new sheet; the copy happens on the first one
      const { hook } = setupHook(store, cmdManager, cellSelection(0, 0));
      await act(async () => { await hook.result.current.runClipboard('copy', A1); });
      store.activateSheet(other);
      await act(async () => { await hook.result.current.runClipboard('paste', A1); });

      const pasted = store.getCell(0, 0, other)!;
      expect(pasted.text).toBe('styled');
      expect(pasted.styleId).not.toBe('shared-id');
      expect(store.getStyle(pasted.styleId!, other)).toEqual({ bold: true });
      expect(store.getStyle('shared-id', other)).toEqual({ italic: true });
      // The same source style is not registered twice.
      await act(async () => { await hook.result.current.runClipboard('paste', { r1: 1, c1: 0, r2: 1, c2: 0 }); });
      expect(store.getCell(1, 0, other)?.styleId).toBe(pasted.styleId);
    });

    it('cut on one sheet, paste on another: the source is cleared where it was cut, the target sheet keeps its own cells', async () => {
      const { store, cmdManager } = setupStore();
      store.setCell(0, 0, { text: 'move' });
      store.addMerge('A1:B1');
      const cut: RangeAddress = { r1: 0, c1: 0, r2: 0, c2: 1 };
      const other = store.addSheet('Other');
      store.setCell(0, 0, { text: 'keep me' }, other); // same coordinates as the cut source
      store.activateSheet(source);
      const { hook } = setupHook(store, cmdManager, cellSelection(0, 0));
      await act(async () => { await hook.result.current.runClipboard('cut', cut); });
      store.activateSheet(other);
      await act(async () => { await hook.result.current.runClipboard('paste', { r1: 2, c1: 0, r2: 2, c2: 1 }); });

      expect(store.getCell(2, 0, other)?.text).toBe('move');
      expect(store.getCell(0, 0, other)?.text).toBe('keep me');
      expect(store.getCell(0, 0, source)?.text ?? '').toBe('');
      expect(store.getMerges(source)).toEqual([]);
      expect(store.getMerges(other)).toEqual(['A3:B3']);
    });

    it('cut on one sheet, paste special on another: same rule', async () => {
      const { store, cmdManager } = setupStore();
      store.setCell(0, 0, { text: 'mv' });
      const other = store.addSheet('Other');
      store.setCell(0, 0, { text: 'stay' }, other);
      store.activateSheet(source);
      const { hook } = setupHook(store, cmdManager, cellSelection(0, 1));
      await act(async () => { await hook.result.current.runClipboard('cut', A1); });
      store.activateSheet(other);
      await act(async () => { await hook.result.current.applyPasteSpecial(DEFAULT_PASTE_SPECIAL); });
      expect(store.getCell(0, 1, other)?.text).toBe('mv');
      expect(store.getCell(0, 0, other)?.text).toBe('stay');
      expect(store.getCell(0, 0, source)?.text ?? '').toBe('');
    });
  });
});
