import type { KeyboardEvent as ReactKeyboardEvent, Dispatch, SetStateAction } from 'react';
import { applyMatrix, clearRange, clearRangeCmd, CompositeCommand } from '../util/rangeValues';
import { fillSelectionPatches } from '../fill/fillSelection';
import { repeatOnRange } from '../commands/repeat';
import type { Command } from '../commands/Command';
import type { DialogName } from './menu/types';
import type { CommandManager } from '../commands/CommandManager';
import { excelSelectAll, edgeJump } from '../selection/currentRegion';
import { isExactlyOneMerge, moveDirection, snapRangeSelection } from '../selection/mergeSnap';
import { skipHiddenCells } from '../selection/visibleStep';
import { KeyboardHandler } from '../keys/KeyboardHandler';
import { Range, type RangeAddress } from '../selection/Range';
import type { Store } from '../store/Store';
import { columnSelection, extendSelection, rangeSelection, rowSelection, type Selection } from '../selection/Selection';
import { COL_HEADER_HEIGHT, ROW_HEIGHT, TOTAL_COLS, TOTAL_ROWS, type CellAddress } from '../renderer/CanvasRenderer';
import { autoSumFormula, cellEditValue, cycleActive, handleMenuShortcut, lastUsedCell, moveArrowTarget, setCellText } from './spreadsheetActions';
import { fillShortcut } from '../fill/fillShortcut';

/** View-only state shared by the canvas, toolbars and keyboard layer. */
export interface ViewState { readonly zoom: number; readonly showFormula: boolean; readonly showGrid: boolean; readonly frozenRows: number; readonly frozenCols: number }

/** Dependencies injected by SpreadsheetComponent — keeps this module React-free and unit-testable. */
export interface KeyboardContext {
  readonly store: Store;
  readonly cmdManager: CommandManager | undefined;
  readonly startEditing: (cell: CellAddress, value?: string, editMode?: boolean) => void;
  readonly selectSelection: (selection: Selection) => void;
  readonly selectRange: (range: RangeAddress) => void;
  readonly setView: Dispatch<SetStateAction<ViewState>>;
  readonly setFindDialog: (name: DialogName | null) => void;
  readonly runClipboard: (type: 'cut' | 'copy' | 'paste', range: RangeAddress) => void;
  readonly clearClipboardSession: () => boolean;
  readonly execCmd: (cmd: Command) => void;
  readonly clearMulti?: () => void;
  readonly multiRanges?: () => readonly RangeAddress[];
  readonly frozenRows: number;
  readonly frozenCols: number;
  readonly zoom: number;
}

/**
 * Excel "End mode": End arms the next arrow to edge-jump (like Ctrl+arrow).
 * Returns true when the event was consumed.
 */
export function handleEndMode(
  event: ReactKeyboardEvent<HTMLCanvasElement>,
  selected: Selection | null,
  store: Store,
  endModeRef: { current: boolean },
  selectSelection: (selection: Selection) => void,
  selectRange: (range: RangeAddress) => void,
): boolean {
  if (event.key === 'End' && !event.ctrlKey && !event.metaKey) {
    endModeRef.current = true;
    event.preventDefault();
    return true;
  }
  if (!endModeRef.current) return false;
  endModeRef.current = false;
  if (selected === null || event.ctrlKey || event.metaKey) return false;
  const dirs: Record<string, { dr: number; dc: number }> = { ArrowUp: { dr: -1, dc: 0 }, ArrowDown: { dr: 1, dc: 0 }, ArrowLeft: { dr: 0, dc: -1 }, ArrowRight: { dr: 0, dc: 1 } };
  const dir = dirs[event.key];
  if (dir === undefined) return false;
  event.preventDefault();
  const target = edgeJump(store, selected.active, dir.dr, dir.dc, TOTAL_ROWS, TOTAL_COLS);
  if (event.shiftKey) selectSelection(extendSelection(selected, target));
  else selectRange(Range.single(target.r, target.c).toAddress());
  return true;
}

export function handleCanvasKeyDown(event: ReactKeyboardEvent<HTMLCanvasElement>, selected: Selection | null, ctx: KeyboardContext): void {
  const { store, cmdManager } = ctx;
  // Excel: Alt+= inserts an AutoSum formula for the column/row around the active cell.
  if (event.altKey && (event.key === '=' || event.key === '＝')) {
    if (selected === null) return;
    event.preventDefault();
    const active = selected.active;
    ctx.startEditing({ r: active.r, c: active.c }, autoSumFormula(store, active.r, active.c), true);
    return;
  }
  if (selected === null || event.altKey) return;
  const range = selected.range;
  const keyboardBase = event.shiftKey ? Range.single(selected.active.r, selected.active.c).toAddress() : range;
  const action = KeyboardHandler.fromReactEvent(event, keyboardBase);
  if (action === null) return;
  event.preventDefault();
  if (action.type === 'move' && action.range !== undefined && (event.key === 'Enter' || event.key === 'Tab') && (range.r1 !== range.r2 || range.c1 !== range.c2) && !isExactlyOneMerge(store, range)) {
    // Excel: Enter/Tab walk the active cell through a multi-cell selection.
    ctx.selectSelection(rangeSelection(range, selected.anchor, cycleActive(range, selected.active, event.key, event.shiftKey)));
  }
  else if (action.type === 'move' && action.range !== undefined && event.shiftKey) {
    // Excel: shift+arrow extension also skips hidden rows/columns.
    const { dr, dc } = moveDirection(range, action.range);
    const visible = skipHiddenCells(store, Range.single(selected.active.r, selected.active.c).toAddress(), action.range, dr, dc);
    ctx.clearMulti?.();
    ctx.selectSelection(snapRangeSelection(store, extendSelection(selected, { r: visible.r1, c: visible.c1 })));
  }
  else if (action.type === 'move' && action.range !== undefined) {
    ctx.clearMulti?.();
    const { dr, dc } = moveDirection(range, action.range);
    ctx.selectRange(moveArrowTarget(store, range, action.range, dr, dc));
  }
  else if (action.type === 'moveEdge') {
    // Excel Ctrl+arrow: jump to the data-region edge; Shift extends the selection to it.
    const target = edgeJump(store, selected.active, action.dr ?? 0, action.dc ?? 0, TOTAL_ROWS, TOTAL_COLS);
    ctx.clearMulti?.();
    if (event.shiftKey) ctx.selectSelection(extendSelection(selected, target));
    else ctx.selectRange(Range.single(target.r, target.c).toAddress());
  }
  else if (action.type === 'jump') {
    // Ctrl+Home: first unfrozen cell (Excel freeze-aware); Ctrl+End: last used cell.
    ctx.clearMulti?.();
    const target = action.jump === 'home' ? { r: ctx.frozenRows, c: ctx.frozenCols } : lastUsedCell(store);
    if (event.shiftKey) ctx.selectSelection(extendSelection(selected, target));
    else ctx.selectRange(Range.single(target.r, target.c).toAddress());
  }
  else if (action.type === 'fill' && action.fillDir !== undefined) { const op = fillShortcut(range, action.fillDir); if (op !== undefined) ctx.execCmd(op); }
  else if (action.type === 'repeat') {
    // Excel F4: replay the last command against the current selection.
    const last = cmdManager?.getLastExecuted();
    const rebound = last !== undefined ? repeatOnRange(last, range) : undefined;
    if (rebound !== undefined) ctx.execCmd(rebound);
  }
  else if (action.type === 'fillSelection') {
    // Excel Ctrl+Enter (no pending edit): re-enter the anchor cell's content across
    // the selection (Excel's active cell stays at the anchor after Shift+arrows/drag).
    const text = cellEditValue(store, selected.anchor);
    const anchorCell = store.getCell(selected.anchor.r, selected.anchor.c);
    applyMatrix(store, cmdManager, range.r1, range.c1, fillSelectionPatches(range, selected.anchor, text, anchorCell?.richText));
  }
  else if (action.type === 'selectColumn') { ctx.clearMulti?.(); ctx.selectSelection(columnSelection(selected.range.c2, TOTAL_ROWS, selected.range.c1)); }
  else if (action.type === 'selectRow') { ctx.clearMulti?.(); ctx.selectSelection(rowSelection(selected.range.r2, TOTAL_COLS, selected.range.r1)); }
  else if (action.type === 'edit') ctx.startEditing({ r: range.r1, c: range.c1 }, undefined, true);
  else if (action.type === 'page' && action.pageDir !== undefined) {
    // Excel: PageUp/PageDown move one screen (viewport rows at the current zoom).
    const canvas = event.currentTarget;
    const rows = Math.max(1, Math.floor((canvas.clientHeight - COL_HEADER_HEIGHT) / (ROW_HEIGHT * (ctx.zoom / 100))));
    ctx.clearMulti?.();
    const target = { r: Math.min(TOTAL_ROWS - 1, Math.max(0, selected.active.r + action.pageDir * rows)), c: selected.active.c };
    if (event.shiftKey) ctx.selectSelection(extendSelection(selected, target));
    else ctx.selectRange(Range.single(target.r, target.c).toAddress());
  }
  else if (action.type === 'backspace') { clearRange(store, cmdManager, range); ctx.startEditing({ r: range.r1, c: range.c1 }, '', true); }
  else if (action.type === 'insertDate') { const now = new Date(); setCellText(store, cmdManager, { r: range.r1, c: range.c1 }, `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()}`); }
  else if (action.type === 'clear') {
    const extras = ctx.multiRanges?.() ?? [];
    if (extras.length === 0) clearRange(store, cmdManager, range);
    else ctx.execCmd(new CompositeCommand([clearRangeCmd(range), ...extras.map(clearRangeCmd)]));
  }
  // Excel: Esc cancels the clipboard session but never changes the selection.
  else if (action.type === 'cancel') ctx.clearClipboardSession();
  else if (action.type === 'type' && action.text !== undefined) { ctx.startEditing({ r: range.r1, c: range.c1 }, action.text); }
  else if (action.type === 'menu' && action.command === 'selectAll') ctx.selectSelection(excelSelectAll(store, selected, TOTAL_ROWS, TOTAL_COLS));
  else if (action.type === 'menu' && action.command !== undefined) handleMenuShortcut(action.command, store, cmdManager, range, ctx.selectRange, ctx.setView, ctx.setFindDialog, ctx.execCmd);
  else if (action.type === 'copy' || action.type === 'cut' || action.type === 'paste') ctx.runClipboard(action.type, range);
}
