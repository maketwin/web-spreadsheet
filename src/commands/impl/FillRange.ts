import { Command } from '../Command';
import { nextSeriesValues } from '../../fill/series';
import type { Store } from '../../store/Store';
import type { RangeAddress } from '../../selection/Range';
import type { Cell } from '../../types';

export interface FillRangeArgs {
  /**
   * Excel fill-handle semantics: a plain drag smart-fills (arithmetic numbers,
   * dates, weekday/month lists, text+number all continue; a lone number and
   * plain text copy). Holding Ctrl toggles: series-able sources copy, while a
   * lone number increments.
   */
  readonly ctrlKey?: boolean;
  /** Force pure copy (no series, no lone-number step) — Excel Ctrl+D / Ctrl+R. */
  readonly copy?: boolean;
  readonly source: RangeAddress;
  readonly target: RangeAddress;
}

export class FillRangeCommand extends Command<FillRangeArgs> {
  private oldCells: Array<{ r: number; c: number; cell: ReturnType<Store['getCell']> }> = [];

  public execute(store: Store): void {
    const { source, target } = this.args;
    this.saveOldCells(store, target);
    const ctrl = this.args.ctrlKey === true;
    const vertical = target.r2 > source.r2 || target.r1 < source.r1;
    if (vertical) {
      for (let c = source.c1; c <= source.c2; c += 1) this.fillLine(store, source, target, c, true, ctrl);
    } else {
      for (let r = source.r1; r <= source.r2; r += 1) this.fillLine(store, source, target, r, false, ctrl);
    }
  }

  public getUndo(): Command {
    return new RestoreFillRange({ cells: this.oldCells });
  }

  private saveOldCells(store: Store, target: RangeAddress): void {
    this.oldCells = [];
    for (let r = target.r1; r <= target.r2; r += 1) {
      for (let c = target.c1; c <= target.c2; c += 1) {
        this.oldCells.push({ r, c, cell: store.getCell(r, c) });
      }
    }
  }

  private fillLine(store: Store, source: RangeAddress, target: RangeAddress, lineIndex: number, vertical: boolean, ctrl: boolean): void {
    const srcLen = vertical ? source.r2 - source.r1 + 1 : source.c2 - source.c1 + 1;
    const cellAt = (i: number): ReturnType<Store['getCell']> =>
      vertical ? store.getCell(source.r1 + i, lineIndex) : store.getCell(lineIndex, source.c1 + i);

    const texts: string[] = [];
    for (let i = 0; i < srcLen; i += 1) texts.push(cellAt(i)?.text ?? '');

    const setAt = (i: number, cell: ReturnType<Store['getCell']>): void => {
      if (vertical) store.setCell(source.r1 + i, lineIndex, cell);
      else store.setCell(lineIndex, source.c1 + i, cell);
    };

    const extend = (from: number, count: number, direction: 1 | -1): void => {
      if (count <= 0) return;
      const smart = nextSeriesValues(texts, count, { direction });
      // Ctrl toggles Excel-style: what would series now copies; what would
      // copy only changes for a lone plain number, which now increments.
      // An explicit copy (Ctrl+D/R shortcut) never continues anything.
      const series = this.args.copy === true
        ? undefined
        : ctrl
          ? (smart !== undefined ? undefined : nextSeriesValues(texts, count, { direction, singleNumberStep: true }))
          : smart;
      for (let i = 1; i <= count; i += 1) {
        const targetIdx = direction === 1 ? from + i : from - i;
        // Copy fallback cycles the source cells; Excel-style, the cell right
        // after the source repeats source[0].
        const srcIdx = ((targetIdx % srcLen) + srcLen) % srcLen;
        const srcCell = cellAt(srcIdx);
        if (srcCell === undefined) continue;
        if (srcCell.formula !== undefined) {
          const offset = targetIdx - srcIdx;
          setAt(targetIdx, {
            ...srcCell,
            formula: shiftFormula(srcCell.formula, vertical ? offset : 0, vertical ? 0 : offset),
          });
          continue;
        }
        const seriesText = series?.[i - 1];
        if (seriesText !== undefined) {
          setAt(targetIdx, rebuildCell(srcCell, seriesText));
        } else {
          setAt(targetIdx, rebuildCell(srcCell, srcCell.text));
        }
      }
    };

    if (vertical) {
      extend(source.r2 - source.r1, target.r2 - source.r2, 1);
      extend(0, source.r1 - target.r1, -1);
    } else {
      extend(source.c2 - source.c1, target.c2 - source.c2, 1);
      extend(0, source.c1 - target.c1, -1);
    }
  }
}

/** New cell from `src`'s look with `text`'s content; keeps styleId and type. */
function rebuildCell(src: Cell, text: string): Cell {
  const out: Cell = { text };
  if (src.text === text && src.value !== undefined) out.value = src.value;
  else {
    const num = Number(text);
    if (text.trim().length > 0 && !Number.isNaN(num)) out.value = num;
  }
  if (src.styleId !== undefined) out.styleId = src.styleId;
  if (src.type !== undefined) out.type = src.type;
  return out;
}

interface RestoreFillRangeArgs {
  readonly cells: ReadonlyArray<{ r: number; c: number; cell: ReturnType<Store['getCell']> }>;
}

class RestoreFillRange extends Command<RestoreFillRangeArgs> {
  public execute(store: Store): void {
    for (const { r, c, cell } of this.args.cells) {
      store.setCell(r, c, cell);
    }
  }

  public getUndo(): Command {
    throw new Error('RestoreFillRange undo not supported');
  }
}

// Rejects tokens inside words/sheet names (e.g. the "T2" in "Sheet2!A1" is
// safe because of the letter lookbehind) while capturing $ anchors.
const CELL_RE = /(?<![A-Za-z0-9_$])(\$?)([A-Z])(\$?)(\d+)(?![A-Za-z0-9_$])/g;

export function shiftFormula(formula: string, dr: number, dc: number): string {
  return formula.replace(CELL_RE, (match, colAbs: string, col: string, rowAbs: string, row: string) => {
    const colIdx = col.charCodeAt(0) - 'A'.charCodeAt(0);
    const rowIdx = parseInt(row, 10) - 1;
    const newCol = colAbs === '$' ? colIdx : colIdx + dc;
    const newRow = rowAbs === '$' ? rowIdx : rowIdx + dr;
    if (newCol < 0 || newCol > 25 || newRow < 0) return match;
    return `${colAbs}${String.fromCharCode('A'.charCodeAt(0) + newCol)}${rowAbs}${newRow + 1}`;
  });
}
