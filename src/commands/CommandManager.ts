import type { EventBus } from '../events/EventBus';
import type { Store } from '../store/Store';
import type { Command } from './Command';

export class CommandManager {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];

  public constructor(
    private readonly store: Store,
    private readonly events?: EventBus,
  ) {}

  public execute(cmd: Command): void {
    cmd.execute(this.store);
    this.undoStack.push(cmd);
    this.redoStack = [];
    this.events?.emit('command:executed', { cmd });
  }

  public undo(): void {
    const cmd = this.undoStack.pop();
    if (cmd === undefined) return;

    cmd.getUndo().execute(this.store);
    this.redoStack.push(cmd);
    this.events?.emit('command:undone', { cmd });
  }

  public redo(): void {
    const cmd = this.redoStack.pop();
    if (cmd === undefined) return;

    cmd.execute(this.store);
    this.undoStack.push(cmd);
    this.events?.emit('command:redone', { cmd });
  }

  public canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  public clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
