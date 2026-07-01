import { Command } from '../Command';
import type { Store } from '../../store/Store';
import type { RangeAddress } from '../../selection/Range';

export interface FillRangeArgs {
  readonly mode: 'copy' | 'series';
  readonly source: RangeAddress;
  readonly target: RangeAddress;
}

export class FillRangeCommand extends Command<FillRangeArgs> {
  private oldCells: Array<{ r: number; c: number; cell: ReturnType<Store['getCell']> }> = [];

  public execute(store: Store): void {
    const { mode, source, target } = this.args;
    this.saveOldCells(store, target);
    if (mode === 'copy') this.fillCopy(store, source, target);
    else this.fillSeries(store, source, target);
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

  private fillCopy(store: Store, source: RangeAddress, target: RangeAddress): void {
    const srcRows = source.r2 - source.r1 + 1;
    const srcCols = source.c2 - source.c1 + 1;
    for (let r = target.r1; r <= target.r2; r += 1) {
      for (let c = target.c1; c <= target.c2; c += 1) {
        if (r >= source.r1 && r <= source.r2 && c >= source.c1 && c <= source.c2) continue;
        const sr = source.r1 + ((r - target.r1) % srcRows);
        const sc = source.c1 + ((c - target.c1) % srcCols);
        const srcCell = store.getCell(sr, sc);
        if (srcCell === undefined) continue;
        const dr = r - sr;
        const dc = c - sc;
        const filled = this.shiftCell(srcCell, dr, dc);
        store.setCell(r, c, filled);
      }
    }
  }

  private fillSeries(store: Store, source: RangeAddress, target: RangeAddress): void {
    const srcRows = source.r2 - source.r1 + 1;
    const srcCols = source.c2 - source.c1 + 1;
    for (let r = target.r1; r <= target.r2; r += 1) {
      for (let c = target.c1; c <= target.c2; c += 1) {
        if (r >= source.r1 && r <= source.r2 && c >= source.c1 && c <= source.c2) continue;
        const blockRow = Math.floor((r - target.r1) / srcRows);
        const sr = source.r1 + ((r - target.r1) % srcRows);
        const sc = source.c1 + ((c - target.c1) % srcCols);
        const srcCell = store.getCell(sr, sc);
        if (srcCell === undefined) continue;
        const dr = r - sr;
        const dc = c - sc;
        const filled = this.seriesCell(srcCell, blockRow, dr, dc);
        store.setCell(r, c, filled);
      }
    }
  }

  private shiftCell(cell: ReturnType<Store['getCell']>, dr: number, dc: number): NonNullable<ReturnType<Store['getCell']>> {
    if (cell?.formula !== undefined) {
      return { ...cell, formula: shiftFormula(cell.formula, dr, dc) };
    }
    const result: NonNullable<ReturnType<Store['getCell']>> = { text: cell?.text ?? '' };
    if (cell?.value !== undefined) result.value = cell.value;
    return result;
  }

  private seriesCell(cell: NonNullable<ReturnType<Store['getCell']>>, _blockRow: number, dr: number, dc: number): NonNullable<ReturnType<Store['getCell']>> {
    if (cell.formula !== undefined) {
      return { ...cell, formula: shiftFormula(cell.formula, dr, dc) };
    }
    const num = Number(cell.text);
    if (cell.text.length > 0 && !Number.isNaN(num)) {
      const inc = dr !== 0 ? dr : dc;
      const val = num + inc;
      return { text: String(val), value: val };
    }
    const result: NonNullable<ReturnType<Store['getCell']>> = { text: cell.text };
    if (cell.value !== undefined) result.value = cell.value;
    return result;
  }
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

const CELL_RE = /\b([A-Z])(\d+)\b/g;

export function shiftFormula(formula: string, dr: number, dc: number): string {
  return formula.replace(CELL_RE, (match, col: string, row: string) => {
    if (match.startsWith('$')) return match;
    const colIdx = col.charCodeAt(0) - 'A'.charCodeAt(0);
    const rowIdx = parseInt(row, 10) - 1;
    const newCol = colIdx + dc;
    const newRow = rowIdx + dr;
    if (newCol < 0 || newCol > 25 || newRow < 0) return match;
    return `${String.fromCharCode('A'.charCodeAt(0) + newCol)}${newRow + 1}`;
  });
}
