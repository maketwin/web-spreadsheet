import type { CommandManager } from '../commands/CommandManager';
import type { Spreadsheet } from '../components/Spreadsheet';
import type { EventBus } from '../events/EventBus';
import { registry as formulaRegistry, type FunctionSpec } from '../formula/registry';
import type { Store } from '../store/Store';

export class PluginAPI {
  public constructor(private readonly ss: Spreadsheet | null) {}

  public get store(): Store {
    if (this.ss === null) throw new Error('PluginAPI not bound to Spreadsheet');
    return this.ss.store;
  }

  public get cmdManager(): CommandManager {
    if (this.ss === null) throw new Error('PluginAPI not bound to Spreadsheet');
    return this.ss.cmdManager;
  }

  public get events(): EventBus {
    if (this.ss === null) throw new Error('PluginAPI not bound to Spreadsheet');
    return this.ss.events;
  }

  public registerFunction(name: string, spec: FunctionSpec): void {
    formulaRegistry.register(name, spec);
  }

  public on(event: string, handler: (payload: unknown) => void): () => void {
    return this.events.on(event, handler);
  }
}
