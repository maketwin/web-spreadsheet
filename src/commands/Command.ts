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

  public describe(): string {
    return this.constructor.name;
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
