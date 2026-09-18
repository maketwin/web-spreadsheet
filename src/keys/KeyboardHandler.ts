import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { TOTAL_COLS, TOTAL_ROWS } from '../renderer/CanvasRenderer';
import { Range, type RangeAddress } from '../selection/Range';

export interface KeyboardAction {
  readonly type: 'move' | 'edit' | 'clear' | 'cancel' | 'copy' | 'paste' | 'cut' | 'type' | 'menu'
    | 'moveEdge' | 'jump' | 'fill' | 'selectColumn' | 'selectRow' | 'page' | 'backspace' | 'insertDate' | 'fillSelection' | 'repeat';
  /** `page`: PageUp (-1) / PageDown (+1) — the caller resolves the viewport row count. */
  readonly pageDir?: -1 | 1;
  readonly range?: RangeAddress;
  readonly text?: string;
  readonly command?: MenuShortcutCommand;
  /** `moveEdge`: step direction of the Ctrl+arrow edge jump. */
  readonly dr?: number;
  readonly dc?: number;
  /** `jump`: Ctrl+Home (first unfrozen cell) / Ctrl+End (last used cell). */
  readonly jump?: 'home' | 'usedEnd';
  /** `fill`: Ctrl+D fills down, Ctrl+R fills right (Excel). */
  readonly fillDir?: 'down' | 'right';
}

export type MenuShortcutCommand = 'save' | 'find' | 'replace' | 'selectAll' | 'bold' | 'italic' | 'underline' | 'zoom100' | 'zoomIn' | 'zoomOut' | 'undo' | 'redo' | 'formatCells' | 'nextSheet' | 'prevSheet' | 'toggleFilter';

export class KeyboardHandler {
  public static next(key: string, range: RangeAddress, shiftKey = false, metaKey = false, ctrlKey = false): KeyboardAction | null {
    // Excel: F4 repeats the last action on the current selection.
    if (key === 'F4' && !metaKey && !ctrlKey) return { type: 'repeat' };
    if (metaKey || ctrlKey) return shortcutAction(key, shiftKey);
    // Excel: Shift+Space selects the entire row of the active cell.
    if (key === ' ' && shiftKey) return { type: 'selectRow' };
    if (key === 'F2') return { type: 'edit' };
    if (key === 'Escape') return { type: 'cancel' };
    if (key === 'Delete') return { type: 'clear' };
    // Excel: Backspace clears the cell and drops into edit mode with an empty editor.
    if (key === 'Backspace') return { type: 'backspace' };
    if (key.length === 1) return { type: 'type', text: key };
    // Excel: Enter commits and moves down; Shift+Enter moves up. F2/double-click edits.
    if (key === 'Enter') return { type: 'move', range: move(range, shiftKey ? -1 : 1, 0) };
    if (key === 'Tab') return { type: 'move', range: move(range, 0, shiftKey ? -1 : 1) };
    if (key === 'ArrowUp') return { type: 'move', range: move(range, -1, 0) };
    if (key === 'ArrowDown') return { type: 'move', range: move(range, 1, 0) };
    if (key === 'ArrowLeft') return { type: 'move', range: move(range, 0, -1) };
    if (key === 'ArrowRight') return { type: 'move', range: move(range, 0, 1) };
    if (key === 'Home') return { type: 'move', range: Range.single(range.r1, 0).toAddress() };
    // Excel: End alone enters "End mode" (handled by the component); End+arrow edge-jumps.
    if (key === 'PageUp') return { type: 'page', pageDir: -1 };
    if (key === 'PageDown') return { type: 'page', pageDir: 1 };
    return null;
  }

  public static fromReactEvent(event: ReactKeyboardEvent<HTMLCanvasElement>, range: RangeAddress): KeyboardAction | null {
    return KeyboardHandler.next(event.key, range, event.shiftKey, event.metaKey, event.ctrlKey);
  }
}

function shortcutAction(key: string, shiftKey = false): KeyboardAction | null {
  // Excel: Ctrl+arrow jumps to the data-region edge (resolved against the store by the caller).
  if (key === 'ArrowUp') return { type: 'moveEdge', dr: -1, dc: 0 };
  if (key === 'ArrowDown') return { type: 'moveEdge', dr: 1, dc: 0 };
  if (key === 'ArrowLeft') return { type: 'moveEdge', dr: 0, dc: -1 };
  if (key === 'ArrowRight') return { type: 'moveEdge', dr: 0, dc: 1 };
  if (key === 'Home') return { type: 'jump', jump: 'home' };
  if (key === 'End') return { type: 'jump', jump: 'usedEnd' };
  if (key === ' ') return { type: 'selectColumn' }; // Excel: Ctrl+Space selects the active cell's column
  if (key === ';') return { type: 'insertDate' }; // Excel: Ctrl+; enters the current date
  if (key === 'PageUp') return { type: 'menu', command: 'prevSheet' };
  if (key === 'PageDown') return { type: 'menu', command: 'nextSheet' };
  // Excel: Ctrl+Enter fills the whole selection with the active cell's content.
  if (key === 'Enter') return { type: 'fillSelection' };
  const normalized = key.toLowerCase();
  // Excel: Ctrl+Shift+L toggles AutoFilter on the selection.
  if (normalized === 'l' && shiftKey) return { type: 'menu', command: 'toggleFilter' };
  if (normalized === 'd') return { type: 'fill', fillDir: 'down' };
  if (normalized === 'r') return { type: 'fill', fillDir: 'right' };
  if (normalized === 'c') return { type: 'copy' };
  if (normalized === 'v') return { type: 'paste' };
  if (normalized === 'x') return { type: 'cut' };
  if (normalized === 's') return { type: 'menu', command: 'save' };
  if (normalized === 'f') return { type: 'menu', command: 'find' };
  if (normalized === 'h') return { type: 'menu', command: 'replace' };
  if (normalized === 'a') return { type: 'menu', command: 'selectAll' };
  if (normalized === 'b') return { type: 'menu', command: 'bold' };
  if (normalized === 'i') return { type: 'menu', command: 'italic' };
  if (normalized === 'u') return { type: 'menu', command: 'underline' };
  if (normalized === '1') return { type: 'menu', command: 'formatCells' }; // Excel: Ctrl+1 Format Cells
  if (normalized === '0') return { type: 'menu', command: 'zoom100' };
  if (normalized === '+' || normalized === '=') return { type: 'menu', command: 'zoomIn' };
  if (normalized === '-') return { type: 'menu', command: 'zoomOut' };
  if (normalized === 'z') return { type: 'menu', command: 'undo' };
  if (normalized === 'y') return { type: 'menu', command: 'redo' };
  return null;
}

function move(range: RangeAddress, dr: number, dc: number): RangeAddress {
  const r = clamp(range.r1 + dr, 0, TOTAL_ROWS - 1);
  const c = clamp(range.c1 + dc, 0, TOTAL_COLS - 1);
  return Range.single(r, c).toAddress();
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
