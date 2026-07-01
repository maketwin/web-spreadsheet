import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { TOTAL_COLS, TOTAL_ROWS } from '../renderer/CanvasRenderer';
import { Range, type RangeAddress } from '../selection/Range';

export interface KeyboardAction {
  readonly type: 'move' | 'edit' | 'clear' | 'cancel' | 'copy' | 'paste' | 'cut' | 'type';
  readonly range?: RangeAddress;
  readonly text?: string;
}

export class KeyboardHandler {
  public static next(key: string, range: RangeAddress, shiftKey = false, metaKey = false, ctrlKey = false): KeyboardAction | null {
    if (metaKey || ctrlKey) return shortcutAction(key);
    if (key === 'F2') return { type: 'edit' };
    if (key === 'Escape') return { type: 'cancel' };
    if (key === 'Delete' || key === 'Backspace') return { type: 'clear' };
    if (key.length === 1) return { type: 'type', text: key };
    if (key === 'Enter' && !shiftKey) return { type: 'edit' };
    if (key === 'Enter' && shiftKey) return { type: 'move', range: move(range, -1, 0) };
    if (key === 'Tab') return { type: 'move', range: move(range, 0, 1) };
    if (key === 'ArrowUp') return { type: 'move', range: move(range, -1, 0) };
    if (key === 'ArrowDown') return { type: 'move', range: move(range, 1, 0) };
    if (key === 'ArrowLeft') return { type: 'move', range: move(range, 0, -1) };
    if (key === 'ArrowRight') return { type: 'move', range: move(range, 0, 1) };
    if (key === 'Home') return { type: 'move', range: Range.single(range.r1, 0).toAddress() };
    if (key === 'End') return { type: 'move', range: Range.single(range.r1, TOTAL_COLS - 1).toAddress() };
    if (key === 'PageUp') return { type: 'move', range: move(range, -10, 0) };
    if (key === 'PageDown') return { type: 'move', range: move(range, 10, 0) };
    return null;
  }

  public static fromReactEvent(event: ReactKeyboardEvent<HTMLCanvasElement>, range: RangeAddress): KeyboardAction | null {
    return KeyboardHandler.next(event.key, range, event.shiftKey, event.metaKey, event.ctrlKey);
  }
}

function shortcutAction(key: string): KeyboardAction | null {
  const normalized = key.toLowerCase();
  if (normalized === 'c') return { type: 'copy' };
  if (normalized === 'v') return { type: 'paste' };
  if (normalized === 'x') return { type: 'cut' };
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
