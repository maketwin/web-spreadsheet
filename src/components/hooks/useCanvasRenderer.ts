import { flushSync } from 'react-dom';
import { useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { CanvasRenderer, COL_WIDTH, TOTAL_COLS, TOTAL_ROWS, type CellAddress } from '../../renderer/CanvasRenderer';
import type { CommandManager } from '../../commands/CommandManager';
import { SetRowHeight } from '../../commands/impl/SetRowHeight';
import { SetColWidth } from '../../commands/impl/SetColWidth';
import { FillRangeCommand } from '../../commands/impl/FillRange';
import { makeMoveRange } from '../../commands/commandFactories';
import { Range, type RangeAddress } from '../../selection/Range';
import { columnSelection, rangeSelection, rowSelection, sheetSelection, type Selection, type SelectionKind } from '../../selection/Selection';
import { snapRangeSelection } from '../../selection/mergeSnap';
import type { Store } from '../../store/Store';
import { autoFitRowHeight } from '../../util/rowAutofit';
import { clampVal } from '../EditorOverlay';
import { allSheetRange } from '../menu/MenuBar';
import type { EditingCell } from '../EditorOverlay';
import type { ViewState } from '../keyboard';

export function useCanvasRenderer(store: Store, selected: Selection | null, onCellClick: (cell: CellAddress, shift: boolean, ctrl: boolean) => void, onSelectionChange: (selection: Selection) => void, view: ViewState, setView: Dispatch<SetStateAction<ViewState>>, cmdManager: CommandManager | undefined, onHeaderContextMenu: (info: { type: 'row'; r: number } | { type: 'column'; c: number }, x: number, y: number) => void, onCellContextMenu: (cell: CellAddress, x: number, y: number) => void, onAutoFilterClick: (r: number, c: number, x: number, y: number) => void, editingLiveRef: RefObject<EditingCell | null>): { canvasRef: RefObject<HTMLCanvasElement | null>; rendererRef: RefObject<CanvasRenderer | null> } {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<CanvasRenderer | null>(null);
  const callbacks = useRef({ onCellClick, onSelectionChange, onHeaderContextMenu, onCellContextMenu, onAutoFilterClick });
  const selectedLiveRef = useRef(selected);
  callbacks.current = { onCellClick, onSelectionChange, onHeaderContextMenu, onCellContextMenu, onAutoFilterClick };
  selectedLiveRef.current = selected;
  useEffect(() => {
    if (canvasRef.current === null) return undefined;
    const currentSelection = selectedLiveRef.current;
    // Row/column header drags carry their kind so the Selection keeps it —
    // rangeSelection would flatten it to a plain range. Cell drags keep the
    // merge-aware snap path.
    const handleSelectionChange = (range: RangeAddress, active?: CellAddress, anchor?: CellAddress, kind?: SelectionKind): void => flushSync(() => {
      callbacks.current.onSelectionChange(kind === 'row' || kind === 'column'
        ? { kind, range: Range.normalize(range), anchor: anchor ?? { r: range.r1, c: range.c1 }, active: active ?? { r: range.r2, c: range.c2 } }
        : snapRangeSelection(store, rangeSelection(range, anchor ?? selectedLiveRef.current?.anchor, active ?? { r: range.r2, c: range.c2 })));
    });
    const base = { canvas: canvasRef.current, store, zoom: view.zoom, showFormula: view.showFormula, showGrid: view.showGrid, frozenRows: view.frozenRows, frozenCols: view.frozenCols, onCellClick: (cell: CellAddress, shift?: boolean, ctrl?: boolean) => flushSync(() => callbacks.current.onCellClick(cell, shift === true, ctrl === true)), onSelectionChange: handleSelectionChange, onColumnSelect: (c: number, shift: boolean) => flushSync(() => { const current = selectedLiveRef.current; callbacks.current.onSelectionChange(columnSelection(c, TOTAL_ROWS, shift && current?.kind === 'column' ? current.anchor.c : c)); }), onRowSelect: (r: number, shift: boolean) => flushSync(() => { const current = selectedLiveRef.current; callbacks.current.onSelectionChange(rowSelection(r, TOTAL_COLS, shift && current?.kind === 'row' ? current.anchor.r : r)); }), onSheetSelect: () => flushSync(() => callbacks.current.onSelectionChange(sheetSelection(allSheetRange()))), onRowResize: (r: number, height: number) => { const cmd = new SetRowHeight({ r, height }); if (cmdManager !== undefined) cmdManager.execute(cmd); else cmd.execute(store); }, onColResize: (c: number, width: number) => { const cmd = new SetColWidth({ c, width }); if (cmdManager !== undefined) cmdManager.execute(cmd); else cmd.execute(store); }, onRowDblClick: (r: number) => { const fit = autoFitRowHeight(store, r); const cmd = new SetRowHeight({ r, height: fit }); if (cmdManager !== undefined) cmdManager.execute(cmd); else cmd.execute(store); }, onColDblClick: (c: number) => { const fit = autoFitColWidth(store, c); const cmd = new SetColWidth({ c, width: fit }); if (cmdManager !== undefined) cmdManager.execute(cmd); else cmd.execute(store); }, onFill: (source: RangeAddress, target: RangeAddress, ctrlKey: boolean) => { const cmd = new FillRangeCommand({ ctrlKey, source, target }); if (cmdManager !== undefined) cmdManager.execute(cmd); else cmd.execute(store); }, onMoveRange: (source: RangeAddress, target: RangeAddress, copy?: boolean) => { const op = makeMoveRange({ source, target, copy }); if (cmdManager !== undefined) cmdManager.execute(op); else op.execute(store); }, onZoom: (delta: number) => setView((current) => ({ ...current, zoom: Math.min(200, Math.max(50, current.zoom + delta)) })), onZoomTo: (zoom: number) => setView((current) => ({ ...current, zoom: Math.min(200, Math.max(50, zoom)) })), onHeaderContextMenu: (info: { type: 'row'; r: number } | { type: 'column'; c: number }, x: number, y: number) => callbacks.current.onHeaderContextMenu(info, x, y), onCellContextMenu: (cell: CellAddress, x: number, y: number) => callbacks.current.onCellContextMenu(cell, x, y), onAutoFilterClick: (r: number, c: number, x: number, y: number) => callbacks.current.onAutoFilterClick(r, c, x, y) };
    const renderer = new CanvasRenderer(currentSelection === null ? base : { ...base, selectedRange: currentSelection.range, selectionKind: currentSelection.kind, activeCell: currentSelection.active });
    rendererRef.current = renderer;
    renderer.setEditing(editingLiveRef.current !== null);
    // Container resizes and devicePixelRatio changes (window dragged between
    // monitors) must re-sync the canvas bitmap — nothing else repaints them.
    const repaint = (): void => { renderer.invalidateAll(); };
    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(repaint) : null;
    resizeObserver?.observe(canvasRef.current);
    let dprQuery = typeof window.matchMedia === 'function' ? window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`) : null;
    const onDprChange = (): void => {
      repaint();
      dprQuery?.removeEventListener('change', onDprChange);
      dprQuery = typeof window.matchMedia === 'function' ? window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`) : null;
      dprQuery?.addEventListener('change', onDprChange);
    };
    dprQuery?.addEventListener('change', onDprChange);
    return () => {
      dprQuery?.removeEventListener('change', onDprChange);
      resizeObserver?.disconnect();
      renderer.destroy();
      rendererRef.current = null;
    };
  // Create the renderer once per store. Zoom / formula / grid toggles flow
  // through setViewOptions below instead of tearing the renderer down (which
  // re-bound every DOM listener and dropped text-metric caches per zoom step).
  }, [store]);
  useEffect(() => rendererRef.current?.setViewOptions({ zoom: view.zoom }), [view.zoom]);
  useEffect(() => rendererRef.current?.setViewOptions({ showFormula: view.showFormula }), [view.showFormula]);
  useEffect(() => rendererRef.current?.setViewOptions({ showGrid: view.showGrid }), [view.showGrid]);
  useEffect(() => rendererRef.current?.setSelection(selected?.range, selected?.kind, selected?.active), [selected]);
  useEffect(() => rendererRef.current?.setFreeze(view.frozenRows, view.frozenCols), [view.frozenRows, view.frozenCols]);
  return { canvasRef, rendererRef };
}

function autoFitColWidth(store: Store, c: number): number {
  let maxLen = 0;
  let hasContent = false;
  for (let r = 0; r < TOTAL_ROWS; r += 1) { const t = store.getCell(r, c)?.text; if (t !== undefined && t.length > 0) { hasContent = true; if (t.length > maxLen) maxLen = t.length; } }
  if (!hasContent) return COL_WIDTH;
  return clampVal(maxLen * 8 + 20, 30, 500);
}
