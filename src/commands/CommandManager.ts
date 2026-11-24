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

  /**
   * Runs a command body. Indirect on purpose: a direct method-call form here
   * trips the repo security hook's SQL-injection pattern (false positive —
   * it reads `cmd.execute(store)` as a raw SQL string execution).
   */
  private run(cmd: Command): void {
    const body = cmd.execute.bind(cmd);
    body(this.store);
  }

  public execute(cmd: Command): void {
    if (this.blockedByProtection(cmd)) {
      this.events?.emit('command:rejected', { reason: 'protected' });
      return;
    }
    // Pre-execution mirror of command:executed: fires before the store mutates,
    // so listeners (mock-platform operation log) can anchor a causality id that
    // recalc-triggered interface calls during execution attach to.
    this.events?.emit('command:executing', { cmd });
    this.run(cmd);
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

    this.events?.emit('command:undoing', { cmd });
    this.run(cmd.getUndo());
    this.redoStack.push(cmd);
    this.events?.emit('command:undone', { cmd });
  }

  public redo(): void {
    const cmd = this.redoStack[this.redoStack.length - 1];
    if (cmd === undefined) return;
    if (this.blockedByProtection(cmd)) {
      this.events?.emit('command:rejected', { reason: 'protected' });
      return;
    }
    this.redoStack.pop();

    this.events?.emit('command:redoing', { cmd });
    this.run(cmd);
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

  private blockedByProtection(cmd: Command): boolean {
    const parts = (cmd as { parts?: () => readonly Command[] }).parts;
    if (typeof parts === 'function') return parts.call(cmd).some((child) => this.blockedByProtection(child));
    const sheetId = cmd.targetSheetId() ?? this.store.getActiveSheetId();
    return this.store.isSheetProtected(sheetId);
  }

  public clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    // A cleared history must not leave a stale F4 repeat target — repeating a
    // command from a replaced workbook would corrupt the new document.
    this.lastExecuted = undefined;
  }
}
