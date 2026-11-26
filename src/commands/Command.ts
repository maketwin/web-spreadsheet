import type { Store } from '../store/Store';

/** Row / column insertion or deletion a command performs. */
export type StructuralKind = 'insertRow' | 'deleteRow' | 'insertCol' | 'deleteCol';

export abstract class Command<TArgs = unknown> {
  /** Command arguments. Public (readonly) so the platform can sample them by type. */
  public readonly args: TArgs;

  public constructor(args: TArgs) {
    this.args = args;
  }

  /**
   * The stable identity of this command — invariant under minification, where
   * a class name is not an identity. Declared by the command itself so tools
   * can classify commands without importing their classes.
   *
   * These names are part of the persisted timeline / repro-bundle format once
   * recorded (see src/commands/replayRegistry.ts): they may only be added to,
   * never renamed. Returns null when a command has no stable identity (the
   * CompositeCommand container).
   */
  public kind(): string | null {
    return null;
  }

  /**
   * The structural change this command makes, if any. Declared by the command
   * itself, so tools can classify commands without importing their classes —
   * a class name is not an identity, and does not survive minification.
   */
  public structuralKind(): StructuralKind | null {
    return null;
  }

  public abstract execute(store: Store): void;

  public abstract getUndo(): Command;

  public shouldMerge(_other: Command): boolean {
    return false;
  }

  /** True when execute() changed nothing — CommandManager keeps it out of the undo history. */
  public isNoOp(): boolean {
    return false;
  }

  /**
   * Estimate of the cells whose undo/redo payload this command keeps in
   * memory; default 0 = negligible. CommandManager runs its retained-cells
   * memory budget on this (see MAX_HISTORY_RETAINED_CELLS). Overrides must
   * count the payload actually retained after execute() — the snapshots the
   * command holds in its own fields — never the selection area.
   */
  public historyWeight(): number {
    return 0;
  }

  public describe(): string {
    return this.constructor.name;
  }

  /** Sheet the command writes, when it records one. Otherwise the active sheet. */
  public targetSheetId(): string | undefined {
    if (this.args === null || typeof this.args !== 'object' || Array.isArray(this.args)) return undefined;
    const sheetId = (this.args as { sheetId?: unknown }).sheetId;
    return typeof sheetId === 'string' ? sheetId : undefined;
  }
}

export function setCommand<TArgs>(
  name: string,
  doFn: (store: Store, args: TArgs) => void,
  undoFn: (store: Store, args: TArgs) => void,
): new (args: TArgs) => Command<TArgs> {
  class UndoCommand extends Command<TArgs> {
    public execute(store: Store): void {
      undoFn(store, this.args);
    }

    public getUndo(): Command {
      return new DoCommand(this.args);
    }

    public override describe(): string {
      return `${name}_undo`;
    }
  }

  class DoCommand extends Command<TArgs> {
    public execute(store: Store): void {
      doFn(store, this.args);
    }

    public getUndo(): Command {
      return new UndoCommand(this.args);
    }

    public override describe(): string {
      return name;
    }
  }

  return DoCommand;
}
