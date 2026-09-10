import { Command } from '../Command';
import type { Store } from '../../store/Store';
import type { RangeAddress } from '../../selection/Range';
import type { Cell, Style } from '../../types';

export type BorderPreset = 'all' | 'outer' | 'inner' | 'none' | 'top' | 'bottom' | 'left' | 'right';
export type BorderLine = 'solid' | 'dashed' | 'dotted' | 'thick' | 'none';

export interface SetRangeBorderArgs extends RangeAddress {
  readonly preset: BorderPreset;
  readonly line: BorderLine;
}

type BorderMap = NonNullable<Style['border']>;
type Edge = keyof BorderMap;
type CellBorderSnapshot = { r: number; c: number; cell: Cell | undefined; style: Style | undefined; styleId: string | undefined };

/**
 * Which edges of cell (r,c) this preset touches inside the selection.
 * Returns null for "clear all borders on this cell".
 * Returns a map of edge -> true for edges that should receive `line` (or be cleared when line is none).
 *
 * Excel completeness notes:
 * - all / none / top / bottom / left / right: per-cell edges as named
 * - outer: only the selection perimeter (no interior spokes)
 * - inner: only interior shared edges (no perimeter)
 * Shared edges are written on both adjacent cells when both are in-range so later
 * "none" / thicker overrides stay consistent; the painter dedupes to one stroke.
 */
export function edgesForPreset(preset: BorderPreset, r: number, c: number, range: RangeAddress): Partial<Record<Edge, true>> | null {
  const atTop = r === range.r1;
  const atBottom = r === range.r2;
  const atLeft = c === range.c1;
  const atRight = c === range.c2;
  switch (preset) {
    case 'none':
      return null;
    case 'all':
      return { top: true, bottom: true, left: true, right: true };
    case 'outer': {
      const out: Partial<Record<Edge, true>> = {};
      if (atTop) out.top = true;
      if (atBottom) out.bottom = true;
      if (atLeft) out.left = true;
      if (atRight) out.right = true;
      return out;
    }
    case 'inner': {
      const inner: Partial<Record<Edge, true>> = {};
      if (!atTop) inner.top = true;
      if (!atBottom) inner.bottom = true;
      if (!atLeft) inner.left = true;
      if (!atRight) inner.right = true;
      return inner;
    }
    case 'top':
      return { top: true };
    case 'bottom':
      return { bottom: true };
    case 'left':
      return { left: true };
    case 'right':
      return { right: true };
  }
}

function cleanBorder(border: BorderMap): BorderMap | undefined {
  const next: BorderMap = {};
  (['top', 'bottom', 'left', 'right'] as const).forEach((edge) => {
    const value = border[edge];
    if (value !== undefined && value !== 'none') next[edge] = value;
  });
  return Object.keys(next).length === 0 ? undefined : next;
}

export class SetRangeBorderCommand extends Command<SetRangeBorderArgs> {
  private snapshots: CellBorderSnapshot[] = [];

  public execute(store: Store): void {
    this.snapshots = [];
    const { preset, line, r1, c1, r2, c2 } = this.args;
    const range = { r1, c1, r2, c2 };

    for (let r = r1; r <= r2; r += 1) {
      for (let c = c1; c <= c2; c += 1) {
        const cell = store.getCell(r, c);
        const oldStyle = cell?.styleId === undefined ? undefined : store.getStyle(cell.styleId);
        this.snapshots.push({ r, c, cell, style: oldStyle, styleId: cell?.styleId });

        const touched = edgesForPreset(preset, r, c, range);
        if (touched === null) {
          // Clear every side — Excel "No Border"
          const styleId = cell?.styleId ?? `cell-${r}-${c}`;
          const base: Style = { ...(oldStyle ?? {}) };
          delete base.border;
          store.setStyle(styleId, base);
          store.setCell(r, c, { ...cell, text: cell?.text ?? '', styleId });
          continue;
        }

        if (Object.keys(touched).length === 0) continue; // interior cell under outer-only: unchanged

        const existing: BorderMap = { ...(oldStyle?.border ?? {}) };
        for (const edge of Object.keys(touched) as Edge[]) {
          if (line === 'none') delete existing[edge];
          else existing[edge] = line;
        }
        const nextBorder = cleanBorder(existing);
        const styleId = cell?.styleId ?? `cell-${r}-${c}`;
        const nextStyle: Style = { ...(oldStyle ?? {}) };
        if (nextBorder === undefined) delete nextStyle.border;
        else nextStyle.border = nextBorder;
        store.setStyle(styleId, nextStyle);
        store.setCell(r, c, { ...cell, text: cell?.text ?? '', styleId });
      }
    }
  }

  public getUndo(): Command {
    return new RestoreRangeBorder(this.snapshots);
  }
}

class RestoreRangeBorder extends Command<readonly CellBorderSnapshot[]> {
  public execute(store: Store): void {
    this.args.forEach((item) => {
      store.setCell(item.r, item.c, item.cell);
      if (item.styleId !== undefined) store.setStyle(item.styleId, item.style);
    });
  }

  public getUndo(): Command {
    return new RestoreRangeBorder(this.args);
  }
}
