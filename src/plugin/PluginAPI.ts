import type { CommandManager } from '../commands/CommandManager';
import type { EventBus } from '../events/EventBus';
import { registry as formulaRegistry, type FunctionSpec } from '../formula/registry';
import type { FormulaEngine } from '../formula/FormulaEngine';
import type { Store } from '../store/Store';

/**
 * Structural host surface the plugin layer needs. The React `Spreadsheet`
 * class satisfies it as-is (public readonly `store` / `cmdManager` /
 * `events` / `formula`), and headless hosts composing
 * `web-spreadsheet/core` can pass their own bundle — the plugin layer never
 * imports the React component.
 */
export interface PluginHost {
  readonly store: Store;
  readonly cmdManager: CommandManager;
  readonly events: EventBus;
  readonly formula: FormulaEngine;
}

export class PluginAPI {
  /** Undos for every function registration / event subscription this API handed out. */
  private readonly undos: Array<() => void> = [];

  public constructor(private readonly host: PluginHost | null) {}

  public get store(): Store {
    if (this.host === null) throw new Error('PluginAPI not bound to a plugin host');
    return this.host.store;
  }

  public get cmdManager(): CommandManager {
    if (this.host === null) throw new Error('PluginAPI not bound to a plugin host');
    return this.host.cmdManager;
  }

  public get events(): EventBus {
    if (this.host === null) throw new Error('PluginAPI not bound to a plugin host');
    return this.host.events;
  }

  public get formula(): FormulaEngine {
    if (this.host === null) throw new Error('PluginAPI not bound to a plugin host');
    return this.host.formula;
  }

  /**
   * Registers a formula function and returns its undo. The undo restores the
   * definition that existed before (builtin or earlier registration); a
   * function created from scratch is removed again.
   */
  public registerFunction(name: string, spec: FunctionSpec): () => void {
    const previous = formulaRegistry.get(name);
    formulaRegistry.register(name, spec);
    return this.track(() => {
      if (previous !== undefined) formulaRegistry.register(name, previous);
      else formulaRegistry.remove(name);
    });
  }

  /** Subscribes on the host event bus; the subscription is tracked for `dispose()`. */
  public on(event: string, handler: (payload: unknown) => void): () => void {
    const off = this.events.on(event, handler);
    return this.track(off);
  }

  /** Undoes every registration / subscription this API ever produced (once each). */
  public dispose(): void {
    while (this.undos.length > 0) this.undos.pop()!();
  }

  /** Wraps an undo so it runs exactly once even if both the caller and `dispose()` trigger it. */
  private track(undo: () => void): () => void {
    let done = false;
    const once = (): void => {
      if (done) return;
      done = true;
      undo();
    };
    this.undos.push(once);
    return once;
  }
}
