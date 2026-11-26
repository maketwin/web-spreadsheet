import { Command } from './Command';
import type { CommandManager } from './CommandManager';
import { SetRangeValues, type CellPatch } from './impl/SetRangeValues';
import { withinMaterializationCap } from './impl/effectiveRange';
import { axisSelectionOf, ClearAxisStyleCommand } from './impl/SetAxisStyle';
import type { CellRect } from '../store/SheetData';
import type { RangeAddress } from '../selection/Range';
import type { Store } from '../store/Store';
import type { Cell } from '../types';

/** Several commands as one undoable unit (Excel: e.g. Delete across a multi-selection is a single undo). */
export class CompositeCommand extends Command<readonly Command[]> {
  public execute(store: Store): void { for (const cmd of this.args) cmd.execute.bind(cmd)(store); }
  public getUndo(): Command { return new CompositeCommand([...this.args].reverse().map((cmd) => cmd.getUndo())); }
  public override describe(): string { return 'Composite'; }
  public parts(): readonly Command[] { return this.args; }
  /** Retained payload: whatever each part keeps (the parts are the original executed commands). */
  public override historyWeight(): number { return this.args.reduce((sum, cmd) => sum + cmd.historyWeight(), 0); }
}

const clearPatch = (): CellPatch => ({ text: '', formula: undefined, value: undefined, styleId: undefined, type: undefined, richText: undefined, hyperlink: undefined });
export function clearRange(store: Store, cmdManager: CommandManager | undefined, range: RangeAddress): void {
  // A selection small enough to materialize is blanked verbatim (exactly the
  // dense walk: ghosts included). Bigger selections collapse to the used
  // part; if even that is past the cap, the stored cells are removed
  // directly instead of writing a dense blank matrix.
  const r1 = Math.min(range.r1, range.r2);
  const c1 = Math.min(range.c1, range.c2);
  const r2 = Math.max(range.r1, range.r2);
  const c2 = Math.max(range.c1, range.c2);
  // Excel: clearing a whole-column / whole-row selection drops the axis
  // default format along with the cells' own formats — one undo unit.
  const axis = axisSelectionOf(range);
  const axisClear = axis === null ? undefined : new ClearAxisStyleCommand({ axis: axis.axis, from: axis.from, to: axis.to });
  let cmd: Command;
  if (withinMaterializationCap({ r1, c1, r2, c2 })) {
    cmd = new SetRangeValues({ r1, c1, r2, c2, values: matrix({ r1, c1, r2, c2 }, clearPatch) });
  } else {
    const eff = store.limitToData(range);
    if (withinMaterializationCap(eff)) {
      cmd = new SetRangeValues({ r1: eff.r1, c1: eff.c1, r2: eff.r2, c2: eff.c2, values: matrix(eff, clearPatch) });
    } else {
      cmd = new ClearCellsCommand({ rect: eff });
    }
  }
  const combined = axisClear === undefined ? cmd : new CompositeCommand([cmd, axisClear]);
  if (cmdManager === undefined) combined.execute.bind(combined)(store);
  else cmdManager.execute.bind(cmdManager)(combined);
}
/** Clear `range` on `sheetId` (default: the active sheet at execution time) — the multi-selection Delete path.
 * Small ranges are blanked verbatim; a range too big to materialize (a whole column inside the selection) has its stored cells removed instead of building a dense matrix. Either way a whole-column / whole-row range also drops the axis default format, exactly like `clearRange` does for a single selection. */
export function clearRangeCmd(range: RangeAddress, sheetId?: string): Command {
  const rect = { r1: Math.min(range.r1, range.r2), c1: Math.min(range.c1, range.c2), r2: Math.max(range.r1, range.r2), c2: Math.max(range.c1, range.c2) };
  const sheet = sheetId !== undefined ? { sheetId } : {};
  const cells = withinMaterializationCap(rect)
    ? new SetRangeValues({ ...rect, values: matrix(rect, clearPatch), ...sheet })
    : new ClearCellsCommand({ rect, ...sheet });
  const axis = axisSelectionOf(rect);
  return axis === null ? cells : new CompositeCommand([cells, new ClearAxisStyleCommand({ axis: axis.axis, from: axis.from, to: axis.to, ...sheet })]);
}

export function applyMatrix(store: Store, cmdManager: CommandManager | undefined, r: number, c: number, values: readonly (readonly (CellPatch | undefined)[])[]): void { const lastRow = values[values.length - 1]; if (lastRow === undefined) return; executeRange(store, cmdManager, r, c, values); }
export function executeRange(store: Store | undefined, cmdManager: CommandManager | undefined, r: number, c: number, values: readonly (readonly (CellPatch | undefined)[])[]): void { const r2 = r + values.length - 1; const c2 = c + (values[0]?.length ?? 1) - 1; const cmd = new SetRangeValues({ r1: r, c1: c, r2, c2, values }); if (cmdManager === undefined) { if (store !== undefined) cmd.execute.bind(cmd)(store); } else cmdManager.execute.bind(cmdManager)(cmd); }
export function matrix(range: RangeAddress, cell: () => CellPatch): CellPatch[][] { return Array.from({ length: range.r2 - range.r1 + 1 }, () => Array.from({ length: range.c2 - range.c1 + 1 }, cell)); }

interface ClearCellsArgs {
  readonly rect: CellRect;
  readonly sheetId?: string;
}

/** Sparse clear: removes the stored cells in the rectangle, records them for
 * undo, allocates nothing for blanks. One sweep and one `cells` event — a
 * whole-column clear over a million stored cells writes and announces
 * nothing per cell; its undo puts the same list back through `bulkSetCells`.
 * Exported for the clipboard's cut-source clear (an entire-column source
 * must not build a dense clear matrix). */
export class ClearCellsCommand extends Command<ClearCellsArgs> {
  /** The cleared cells as `[key, cell]` (key = r * TOTAL_COLS + c) — the shape `bulkSetCells` takes back. */
  private before: ReadonlyArray<readonly [number, Cell]> = [];
  private execSheetId: string | undefined;

  /** Retained payload: one snapshot entry per cleared stored cell. */
  public override historyWeight(): number { return this.before.length; }

  public execute(store: Store): void {
    const sid = this.args.sheetId ?? this.execSheetId ?? store.getActiveSheetId();
    this.execSheetId = sid;
    this.before = store.takeCellsInRect(this.args.rect, sid);
  }

  public getUndo(): Command {
    return new RestoreClearedCells({ cells: this.before, ...(this.execSheetId !== undefined ? { sheetId: this.execSheetId } : {}) });
  }
}

interface RestoreClearedCellsArgs {
  readonly cells: ReadonlyArray<readonly [number, Cell]>;
  readonly sheetId?: string;
}

class RestoreClearedCells extends Command<RestoreClearedCellsArgs> {
  /** Retained payload: the restored cell list it holds (its own undo is a fresh empty clear). */
  public override historyWeight(): number { return this.args.cells.length; }

  public execute(store: Store): void {
    store.bulkSetCells(this.args.cells, this.args.sheetId ?? store.getActiveSheetId());
  }

  public getUndo(): Command {
    return new ClearCellsCommand({ rect: { r1: 0, c1: 0, r2: 0, c2: 0 } });
  }
}
