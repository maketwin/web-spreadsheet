import type { Store } from '../store/Store';

export abstract class Command<TArgs = unknown> {
  protected readonly args: TArgs;

  public constructor(args: TArgs) {
    this.args = args;
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
