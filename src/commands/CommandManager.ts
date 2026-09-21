import type { EventBus } from '../events/EventBus';
import type { Store } from '../store/Store';
import type { Command } from './Command';

export interface HistoryEntry {
  readonly description: string;
  readonly index: number;
}

export class CommandManager {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  /** Most recent user-executed command — the F4 repeat source (Excel). Undo/redo do not touch it. */
  private lastExecuted: Command | undefined;

  public constructor(
    private readonly store: Store,
    private readonly events?: EventBus,
  ) {}

  public get activeSheetId(): string {
    return this.store.getActiveSheetId();
  }

  public execute(cmd: Command): void {
    cmd.execute(this.store);
    // No-op commands (e.g. unmerge where nothing is merged) never enter history.
    if (cmd.isNoOp()) return;
    this.undoStack.push(cmd);
    this.redoStack = [];
    this.lastExecuted = cmd;
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

  public getLastExecuted(): Command | undefined {
    return this.lastExecuted;
  }

  public canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  public getUndoStack(): readonly HistoryEntry[] {
    return this.undoStack.map((cmd, i) => ({ description: cmd.describe(), index: i }));
  }

  public getRedoStack(): readonly HistoryEntry[] {
    return this.redoStack.map((cmd, i) => ({ description: cmd.describe(), index: i }));
  }

  /** Undo back to a specific index in the undo stack (0-based). */
  public undoToIndex(targetIndex: number): void {
    while (this.undoStack.length > targetIndex + 1) {
      this.undo();
    }
  }

  public clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    // A cleared history must not leave a stale F4 repeat target — repeating a
    // command from a replaced workbook would corrupt the new document.
    this.lastExecuted = undefined;
  }
}
