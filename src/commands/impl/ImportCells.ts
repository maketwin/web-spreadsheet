import { Command } from '../Command';
import { TOTAL_COLS } from '../../util/gridSize';

import type { Store } from '../../store/Store';
import type { Cell } from '../../types';

export type ImportedCells = readonly (readonly [number, number, Cell])[];

/**
 * Whole-block cell import (e.g. JSON workbook import) as ONE undo step: undo
 * restores every cell the import overwrote or created, including removing
 * cells that did not exist before.
 */
export class ImportCellsCommand extends Command<ImportedCells> {
  private before: readonly (readonly [number, number, Cell | undefined])[] = [];
  private execSheetId: string | undefined;

  public override kind(): 'importCells' { return 'importCells'; }

  /** Retained payload: one before entry per imported/overwritten cell. */
  public override historyWeight(): number {
    return this.before.length;
  }

  public execute(store: Store): void {
    const sid = this.execSheetId ?? store.getActiveSheetId();
    this.execSheetId = sid;
    // Numeric keys over the stored cells — no "r,c" strings per cell.
    const before = new Map<number, readonly [number, number, Cell | undefined]>();
    store.forEachCell((r, c, cell) => before.set(r * TOTAL_COLS + c, [r, c, cell]), sid);
    for (const [r, c] of this.args) {
      const key = r * TOTAL_COLS + c;
      if (!before.has(key)) before.set(key, [r, c, undefined]);
    }
    this.before = [...before.values()];
    for (const [r, c, cell] of this.args) store.setCell(r, c, cell, sid);
  }

  public getUndo(): Command {
    return new RestoreImportedCells(this.before, this.execSheetId);
  }

  public override describe(): string {
    return 'ImportCells';
  }
}

interface RestoreImportedCellsArgs {
  readonly cells: readonly (readonly [number, number, Cell | undefined])[];
  readonly sheetId?: string;
}

class RestoreImportedCells extends Command<RestoreImportedCellsArgs> {
  public constructor(cells: readonly (readonly [number, number, Cell | undefined])[], sheetId?: string) {
    super({ cells, ...(sheetId !== undefined ? { sheetId } : {}) });
  }

  public execute(store: Store): void {
    const sid = this.args.sheetId ?? store.getActiveSheetId();
    for (const [r, c, cell] of this.args.cells) store.setCell(r, c, cell, sid);
  }

  public getUndo(): Command {
    return this;
  }
}
