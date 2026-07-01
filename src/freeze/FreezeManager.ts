export interface FreezeState {
  readonly frozenRows: number;
  readonly frozenCols: number;
}

export interface FreezeOptions {
  readonly totalRows: number;
  readonly totalCols: number;
}

const EMPTY_FREEZE: FreezeState = { frozenRows: 0, frozenCols: 0 };

export class FreezeManager {
  private state: FreezeState = { ...EMPTY_FREEZE };

  public constructor(private readonly opts: FreezeOptions) {}

  public getFrozenRows(): number {
    return this.state.frozenRows;
  }

  public getFrozenCols(): number {
    return this.state.frozenCols;
  }

  public getState(): FreezeState {
    return this.state;
  }

  /** Freeze rows above `row` and columns left of `col`.
   *  E.g. cell B2 → freeze row 1 + col A → frozenRows=1, frozenCols=1 */
  public freezeAt(row: number, col: number): void {
    this.state = {
      frozenRows: Math.min(row, this.opts.totalRows),
      frozenCols: Math.min(col, this.opts.totalCols),
    };
  }

  public unfreeze(): void {
    this.state = { ...EMPTY_FREEZE };
  }

  public isFrozen(): boolean {
    return this.state.frozenRows > 0 || this.state.frozenCols > 0;
  }

  /** Adjust a visible range to exclude frozen rows/cols from the scrollable area. */
  public adjustVisibleRange(range: { startRow: number; endRow: number; startCol: number; endCol: number }): {
    startRow: number; endRow: number; startCol: number; endCol: number;
  } {
    return {
      startRow: Math.max(range.startRow, this.state.frozenRows),
      endRow: range.endRow,
      startCol: Math.max(range.startCol, this.state.frozenCols),
      endCol: range.endCol,
    };
  }
}
