import { Command } from '../commands/Command';
import type { CommandManager } from '../commands/CommandManager';
import { SetRangeValues, type CellPatch } from '../commands/impl/SetRangeValues';
import type { RangeAddress } from '../selection/Range';
import type { Store } from '../store/Store';

/** Several commands as one undoable unit (Excel: e.g. Delete across a multi-selection is a single undo). */
export class CompositeCommand extends Command<readonly Command[]> {
  public execute(store: Store): void { for (const cmd of this.args) cmd.execute(store); }
  public getUndo(): Command { return new CompositeCommand([...this.args].reverse().map((cmd) => cmd.getUndo())); }
  public override describe(): string { return 'Composite'; }
  public parts(): readonly Command[] { return this.args; }
}

export function clearRange(store: Store, cmdManager: CommandManager | undefined, range: RangeAddress): void { const values = matrix(range, () => ({ text: '' })); executeRange(store, cmdManager, range.r1, range.c1, values); }
export function clearRangeCmd(range: RangeAddress): Command { const values = matrix(range, () => ({ text: '' })); return new SetRangeValues({ r1: range.r1, c1: range.c1, r2: range.r2, c2: range.c2, values }); }
export function applyMatrix(store: Store, cmdManager: CommandManager | undefined, r: number, c: number, values: readonly (readonly (CellPatch | undefined)[])[]): void { const lastRow = values[values.length - 1]; if (lastRow === undefined) return; executeRange(store, cmdManager, r, c, values); }
export function executeRange(store: Store | undefined, cmdManager: CommandManager | undefined, r: number, c: number, values: readonly (readonly (CellPatch | undefined)[])[]): void { const r2 = r + values.length - 1; const c2 = c + (values[0]?.length ?? 1) - 1; const cmd = new SetRangeValues({ r1: r, c1: c, r2, c2, values }); if (cmdManager === undefined) { if (store !== undefined) cmd.execute(store); } else cmdManager.execute(cmd); }
export function matrix(range: RangeAddress, cell: () => CellPatch): CellPatch[][] { return Array.from({ length: range.r2 - range.r1 + 1 }, () => Array.from({ length: range.c2 - range.c1 + 1 }, cell)); }
