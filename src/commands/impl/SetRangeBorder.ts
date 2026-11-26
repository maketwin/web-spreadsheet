import { Command } from '../Command';
import { SetAxisStyleCommand, axisSelectionOf, type StyleAxis, type StylePatch } from './SetAxisStyle';
import { StyleUsage } from './styleIdentity';
import { effectiveRange, withinMaterializationCap } from './effectiveRange';
import type { Store } from '../../store/Store';
import type { RangeAddress } from '../../selection/Range';
import type { Cell, Style } from '../../types';

export type BorderPreset = 'all' | 'outer' | 'inner' | 'none' | 'top' | 'bottom' | 'left' | 'right';
export type BorderLine = 'solid' | 'dashed' | 'dotted' | 'thick' | 'none';

export interface SetRangeBorderArgs extends RangeAddress {
  readonly preset: BorderPreset;
  readonly line: BorderLine;
  /** Target sheet; defaults to the active sheet at execution time. */
  readonly sheetId?: string;
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

/**
 * Axis-default delta for a preset on a whole-column / whole-row selection.
 * An axis has no left/right edges when it spans all rows (and no top/bottom
 * when it spans all columns), so `outer` keeps only the edges that exist
 * along the band; `inner` becomes the edges that repeat along it. `line`
 * `'none'` clears the edges it touches (the delta's undefined edges drop).
 */
export function axisBorderDelta(preset: BorderPreset, axis: StyleAxis, line: BorderLine): StylePatch {
  const edge = line === 'none' ? undefined : line;
  switch (preset) {
    case 'none': return { border: undefined };
    case 'all': return { border: { top: edge, bottom: edge, left: edge, right: edge } };
    case 'outer': return axis === 'col' ? { border: { left: edge, right: edge } } : { border: { top: edge, bottom: edge } };
    // An axis band's repeating edges: horizontal ones on a column, vertical ones on a row.
    case 'inner': return axis === 'col' ? { border: { top: edge, bottom: edge } } : { border: { left: edge, right: edge } };
    case 'top': return { border: { top: edge } };
    case 'bottom': return { border: { bottom: edge } };
    case 'left': return { border: { left: edge } };
    case 'right': return { border: { right: edge } };
  }
}

export class SetRangeBorderCommand extends Command<SetRangeBorderArgs> {
  private snapshots: CellBorderSnapshot[] = [];
  private execSheetId: string | undefined;
  /** Set when the selection turned out to be a whole-axis format write. */
  private axisCommand: SetAxisStyleCommand | undefined;

  public override kind(): 'setRangeBorder' { return 'setRangeBorder'; }

  public execute(store: Store): void {
    this.snapshots = [];
    this.axisCommand = undefined;
    const { preset, line } = this.args;
    const target = this.args.sheetId ?? this.execSheetId ?? store.getActiveSheetId();
    this.execSheetId = target;
    // Excel: borders on a whole-column / whole-row selection are an axis
    // default write — one meta per column/row, no cells materialized.
    const axis = axisSelectionOf(this.args);
    if (axis !== null) {
      const axisCmd = new SetAxisStyleCommand({ axis: axis.axis, from: axis.from, to: axis.to, style: axisBorderDelta(preset, axis.axis, line), sheetId: target });
      axisCmd.execute.bind(axisCmd)(store);
      this.axisCommand = axisCmd;
      return;
    }
    // Edge geometry keys off the effective range: within the used area it is
    // the selection itself, and a near-axis selection past the materialization
    // cap draws its perimeter at the data edge instead of materializing rows.
    const range = effectiveRange(store, this.args, target);
    const usage = StyleUsage.capture(store, target);

    const each = (r: number, c: number): void => {
      const cell = store.getCell(r, c, target);
      // Undo restores the cell's OWN style entry; the merge base is the style
      // in EFFECT, so a border added to one cell of a bold column keeps bold.
      const ownStyle = cell?.styleId === undefined ? undefined : store.getStyle(cell.styleId, target);
      const effective = store.getCellStyle(r, c, cell, target);
      this.snapshots.push({ r, c, cell, style: ownStyle, styleId: cell?.styleId });

      const touched = edgesForPreset(preset, r, c, range);
      if (touched === null) {
        // Clear every side — Excel "No Border"
        const styleId = usage.forCell(r, c, cell?.styleId);
        const base: Style = { ...(effective ?? {}) };
        delete base.border;
        store.setStyle(styleId, base, target);
        store.setCell(r, c, { ...cell, text: cell?.text ?? '', styleId }, target);
        usage.reassign(cell?.styleId, styleId);
        return;
      }

      if (Object.keys(touched).length === 0) return; // interior cell under outer-only: unchanged

      const existing: BorderMap = { ...(effective?.border ?? {}) };
      for (const edge of Object.keys(touched) as Edge[]) {
        if (line === 'none') delete existing[edge];
        else existing[edge] = line;
      }
      const nextBorder = cleanBorder(existing);
      const styleId = usage.forCell(r, c, cell?.styleId);
      const nextStyle: Style = { ...(effective ?? {}) };
      if (nextBorder === undefined) delete nextStyle.border;
      else nextStyle.border = nextBorder;
      store.setStyle(styleId, nextStyle, target);
      store.setCell(r, c, { ...cell, text: cell?.text ?? '', styleId }, target);
      usage.reassign(cell?.styleId, styleId);
    };

    if (withinMaterializationCap(range)) {
      for (let r = range.r1; r <= range.r2; r += 1) {
        for (let c = range.c1; c <= range.c2; c += 1) each(r, c);
      }
    } else {
      store.forEachCellInRect(range, (r, c) => each(r, c), target);
    }
  }

  public getUndo(): Command {
    if (this.axisCommand !== undefined) return this.axisCommand.getUndo();
    return new RestoreRangeBorder({ snapshots: this.snapshots, ...(this.execSheetId !== undefined ? { sheetId: this.execSheetId } : {}) });
  }
}

interface RestoreRangeBorderArgs {
  readonly snapshots: readonly CellBorderSnapshot[];
  readonly sheetId?: string;
}

class RestoreRangeBorder extends Command<RestoreRangeBorderArgs> {
  public execute(store: Store): void {
    const target = this.args.sheetId ?? store.getActiveSheetId();
    this.args.snapshots.forEach((item) => {
      store.setCell(item.r, item.c, item.cell, target);
      if (item.styleId !== undefined) store.setStyle(item.styleId, item.style, target);
    });
  }

  public getUndo(): Command {
    return this;
  }
}
