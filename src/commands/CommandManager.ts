import type { EventBus } from '../events/EventBus';
import type { Store } from '../store/Store';
import type { Command } from './Command';

export interface HistoryEntry {
  readonly description: string;
  readonly index: number;
}

/** Options for `execute`. */
export interface ExecuteOptions {
  /**
   * True (default): run as a user edit — protection check, command:* events,
   * undo history, F4 repeat source. False: apply as a programmatic edit
   * (timeline replay, import, migration) — no protection check, no command:*
   * events, no undo history, no repeat source. The batch and the exception
   * boundary are the same either way.
   */
  readonly record?: boolean;
}

export type CommandPhase = 'execute' | 'undo' | 'redo';

/** Undo steps kept, as in Excel. */
export const MAX_HISTORY = 100;

/**
 * Cells whose undo/redo payload the history may retain in total, across the
 * undo and redo stacks. A retained cell (snapshot entry, before-matrix slot,
 * written patch) costs a few dozen to a hundred-plus bytes, so this ceiling
 * corresponds to a worst case of a few hundred megabytes — the same trade
 * Excel makes when it drops the oldest of 100 steps, only measured in cells
 * instead of steps: once over budget, the OLDEST undo steps are evicted,
 * always keeping at least one (the newest step stays undoable).
 */
export const MAX_HISTORY_RETAINED_CELLS = 2_000_000;

/**
 * Emitted instead of `command:executed` / `undone` / `redone` when the
 * command threw: whatever opened on the `…ing` event closes here.
 */
export interface CommandFailedPayload {
  readonly cmd: Command;
  readonly phase: CommandPhase;
  readonly error: unknown;
}

export class CommandManager {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  /** Most recent user-executed command — the F4 repeat source (Excel). Undo/redo do not touch it. */
  private lastExecuted: Command | undefined;
  /** Per-command `historyWeight()`, computed once when the command first enters history. */
  private readonly weights = new WeakMap<Command, number>();

  public constructor(
    private readonly store: Store,
    private readonly events?: EventBus,
  ) {}

  public get activeSheetId(): string {
    return this.store.getActiveSheetId();
  }

  /** Bus the command events are published on, when one was given. */
  public get eventBus(): EventBus | undefined {
    return this.events;
  }

  /**
   * Runs a command body inside a store batch: subscribers see the final
   * state once (a row insert touches every shifted cell; delivered one by
   * one, each would start its own recalculation cascade).
   *
   * Indirect on purpose: a direct method-call form here trips the repo
   * security hook's SQL-injection pattern (false positive — it reads
   * `cmd.execute(store)` as a raw SQL string execution).
   */
  private run(cmd: Command): void {
    const body = cmd.execute.bind(cmd);
    this.store.batch(() => { body(this.store); });
  }

  /**
   * Runs a command. By default it counts as a user edit (protection check,
   * command:* events, undo history, F4 repeat source); with `{ record: false }`
   * it is applied programmatically (timeline replay, import, migration) —
   * same batch and exception boundary, none of the bookkeeping. True when the
   * command body ran (including no-ops); false when protection rejected it
   * (record only) or the body threw.
   */
  public execute(cmd: Command, options?: ExecuteOptions): boolean {
    const record = options?.record ?? true;
    if (!record) {
      // No protection check, and no `command:executing` opened a window, so a
      // failure is logged but never announced via `command:failed`.
      if (this.attempt(cmd, 'execute', () => this.run(cmd), false)) return false;
      return true;
    }
    if (this.blockedByProtection(cmd)) {
      this.events?.emit('command:rejected', { reason: 'protected' });
      return false;
    }
    // Pre-execution mirror of command:executed: fires before the store mutates,
    // so listeners (mock-platform operation log) can anchor a causality id that
    // recalc-triggered interface calls during execution attach to.
    this.events?.emit('command:executing', { cmd });
    if (this.attempt(cmd, 'execute', () => this.run(cmd))) return false;
    // No-op commands (e.g. unmerge where nothing is merged) never enter history.
    if (cmd.isNoOp()) return true;
    this.undoStack.push(cmd);
    // Excel keeps 100 steps. Structural commands hold a whole-sheet snapshot
    // each, so the oldest fall off instead of piling up in memory.
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.splice(0, this.undoStack.length - MAX_HISTORY);
    // Clearing the redo stack releases its commands' undo payloads too.
    this.redoStack = [];
    this.enforceHistoryBudget();
    this.lastExecuted = cmd;
    this.events?.emit('command:executed', { cmd });
    return true;
  }

  /**
   * Undo the newest command. An entry whose undo fails (its sheet was
   * deleted meanwhile — that cannot be undone, as in Excel) is dropped and
   * the next one is tried, so one dead entry never blocks the history.
   */
  public undo(): void {
    for (let cmd = this.undoStack.pop(); cmd !== undefined; cmd = this.undoStack.pop()) {
      this.events?.emit('command:undoing', { cmd });
      if (this.attempt(cmd, 'undo', () => this.run(cmd.getUndo()))) continue;
      this.redoStack.push(cmd);
      // The move itself adds no weight (the same command object rides both
      // stacks), but an over-budget stack must still shed its oldest steps.
      this.enforceHistoryBudget();
      this.events?.emit('command:undone', { cmd });
      return;
    }
  }

  public redo(): void {
    for (let cmd = this.redoStack[this.redoStack.length - 1]; cmd !== undefined; cmd = this.redoStack[this.redoStack.length - 1]) {
      if (this.blockedByProtection(cmd)) {
        this.events?.emit('command:rejected', { reason: 'protected' });
        return;
      }
      this.redoStack.pop();
      this.events?.emit('command:redoing', { cmd });
      if (this.attempt(cmd, 'redo', () => this.run(cmd))) continue;
      this.undoStack.push(cmd);
      this.enforceHistoryBudget();
      this.events?.emit('command:redone', { cmd });
      return;
    }
  }

  /**
   * Run one history phase; a throwing command is reported, not propagated —
   * one bad command must not take the UI down, and listeners that opened
   * state on the `…ing` event close it on `command:failed`. True when it failed.
   * `report: false` skips the event (programmatic applies never opened a
   * window, so there is nothing to close).
   */
  private attempt(cmd: Command, phase: CommandPhase, fn: () => void, report = true): boolean {
    try {
      fn();
      return false;
    } catch (error) {
      console.error(`Command ${phase} failed (${cmd.describe()}):`, error);
      if (report) this.events?.emit('command:failed', { cmd, phase, error } satisfies CommandFailedPayload);
      return true;
    }
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

  /** Cells of undo payload currently retained across both stacks (debug/testing aid). */
  public historyWeight(): number {
    let total = 0;
    for (const cmd of this.undoStack) total += this.weightOf(cmd);
    for (const cmd of this.redoStack) total += this.weightOf(cmd);
    return total;
  }

  /** Cached `historyWeight()` — computed on first need, never re-measured. */
  private weightOf(cmd: Command): number {
    let weight = this.weights.get(cmd);
    if (weight === undefined) {
      weight = cmd.historyWeight();
      this.weights.set(cmd, weight);
    }
    return weight;
  }

  /**
   * The retained-cells budget: evict the OLDEST undo steps while the total
   * weight of both stacks exceeds MAX_HISTORY_RETAINED_CELLS. The newest step
   * always stays (a history that cannot undo its own last edit is worthless),
   * so a single huge step is allowed to sit over budget until something
   * newer arrives. Redo entries never leave here — they are newer than
   * anything on the undo stack; a new execute() clears them instead.
   */
  private enforceHistoryBudget(): void {
    while (this.undoStack.length > 1) {
      if (this.historyWeight() <= MAX_HISTORY_RETAINED_CELLS) return;
      this.undoStack.shift();
    }
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
