import { useCallback, useRef, useState, type MutableRefObject, type RefObject } from 'react';
import { message } from 'antd';
import { ClipboardService } from '../../clipboard/ClipboardService';
import { buildPasteSpecialMatrix, type PasteSpecialOptions } from '../../clipboard/pasteSpecial';
import { buildSessionPasteValues, combineMultiRanges, pasteFromClipboard, snapshotCells, type ClipboardSessionState } from '../../clipboard/session';
import { applyMatrix, clearRange } from '../../util/rangeValues';
import type { CommandManager } from '../../commands/CommandManager';
import type { CanvasRenderer } from '../../renderer/CanvasRenderer';
import type { RangeAddress } from '../../selection/Range';
import type { Selection } from '../../selection/Selection';
import type { Store } from '../../store/Store';

export interface ClipboardSessionApi {
  readonly clipboardSession: MutableRefObject<ClipboardSessionState | null>;
  readonly clearClipboardSession: () => boolean;
  readonly runClipboard: (type: 'cut' | 'copy' | 'paste', range: RangeAddress) => Promise<void>;
  readonly runCtxClipboard: (type: 'cut' | 'copy' | 'paste' | 'clear') => void;
  readonly pasteSpecialOpen: boolean;
  readonly setPasteSpecialOpen: (open: boolean) => void;
  readonly applyPasteSpecial: (opts: PasteSpecialOptions) => Promise<void>;
}

/**
 * Excel clipboard session: copy/cut mark a source (marching ants); cut clears
 * the source only when the paste lands. Copy sessions allow repeated pastes;
 * cut pastes once.
 */
export function useClipboardSession(store: Store, cmdManager: CommandManager | undefined, rendererRef: RefObject<CanvasRenderer | null>, selectedRef: RefObject<Selection | null>, multiRef: RefObject<readonly RangeAddress[]>): ClipboardSessionApi {
  const clipboardSession = useRef<ClipboardSessionState | null>(null);
  const clearClipboardSession = useCallback((): boolean => {
    const had = clipboardSession.current !== null;
    clipboardSession.current = null;
    rendererRef.current?.setClipboardRange(undefined);
    return had;
  }, [rendererRef]);
  const [pasteSpecialOpen, setPasteSpecialOpen] = useState(false);
  const applyPasteSpecial = useCallback(async (opts: PasteSpecialOptions) => {
    setPasteSpecialOpen(false);
    const target = selectedRef.current?.range;
    if (target === undefined) return;
    const session = clipboardSession.current;
    const source = session !== null
      ? session
      : { type: 'copy' as const, range: { r1: 0, c1: 0, r2: 0, c2: 0 }, cells: await ClipboardService.read() };
    if (source.cells.length === 0) return;
    applyMatrix(store, cmdManager, target.r1, target.c1, buildPasteSpecialMatrix(store, source, target.r1, target.c1, target, opts));
    // Excel: a cut session ends on the first paste; the source clears when content moved.
    if (session !== null && session.type === 'cut') {
      if (opts.mode !== 'formats' && opts.operation === 'none' && !opts.transpose) clearRange(store, cmdManager, session.range);
      clearClipboardSession();
    }
  }, [store, cmdManager, selectedRef, clearClipboardSession]);
  const runClipboard = useCallback(async (type: 'cut' | 'copy' | 'paste', range: RangeAddress) => {
    if (type === 'paste') {
      const session = clipboardSession.current;
      if (session !== null) {
        // Excel in-app paste: formulas ride along (copy shifts relative refs to
        // the target, cut moves them verbatim) and cell styles are preserved.
        applyMatrix(store, cmdManager, range.r1, range.c1, buildSessionPasteValues(session, range.r1, range.c1, range));
        if (session.type === 'cut') { clearRange(store, cmdManager, session.range); clearClipboardSession(); }
        return;
      }
      await pasteFromClipboard(store, cmdManager, range);
      return;
    }
    const extras = multiRef.current ?? [];
    if (extras.length > 0) {
      // Excel multi-area copy: only when the ranges line up by rows or columns.
      const combined = combineMultiRanges(store, [range, ...extras]);
      if (combined === null) { message.warning('不能对多重选定区域使用此命令'); return; }
      await ClipboardService.copy(store, combined.range);
      clipboardSession.current = { type, range: combined.range, text: combined.text, cells: combined.cells };
      rendererRef.current?.setClipboardRange(combined.range);
      return;
    }
    const payload = ClipboardService.createPayload(store, range);
    if (payload === null) return;
    await ClipboardService.copy(store, range);
    clipboardSession.current = { type, range, text: payload.text, cells: snapshotCells(store, range) };
    rendererRef.current?.setClipboardRange(range);
  }, [store, cmdManager, rendererRef, multiRef, clearClipboardSession]);
  const runCtxClipboard = useCallback((type: 'cut' | 'copy' | 'paste' | 'clear') => {
    const range = selectedRef.current?.range;
    if (range === undefined) return;
    if (type === 'clear') clearRange(store, cmdManager, range);
    else void runClipboard(type, range);
  }, [store, cmdManager, selectedRef, runClipboard]);
  return { clipboardSession, clearClipboardSession, runClipboard, runCtxClipboard, pasteSpecialOpen, setPasteSpecialOpen, applyPasteSpecial };
}
