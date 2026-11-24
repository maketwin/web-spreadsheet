import { PluginAPI, type PluginHost } from './PluginAPI';

export interface Plugin {
  readonly name?: string;
  install: (api: PluginAPI) => void;
}

export type { PluginHost } from './PluginAPI';

export class PluginManager {
  private readonly plugins: Plugin[] = [];
  private readonly apis: PluginAPI[] = [];

  /** Structural host (`PluginHost`) — the React `Spreadsheet` class satisfies it as-is. */
  public constructor(private readonly host: PluginHost) {}

  public use(plugin: Plugin): this {
    const api = new PluginAPI(this.host);
    // Record the API before install: a plugin that throws mid-install has
    // already registered functions / subscriptions through it — dispose those
    // and rethrow (the failed plugin is not listed, and nothing leaks).
    this.apis.push(api);
    try {
      plugin.install(api);
    } catch (err) {
      api.dispose();
      this.apis.pop();
      throw err;
    }
    this.plugins.push(plugin);
    return this;
  }

  public list(): readonly string[] {
    return this.plugins.map((plugin) => plugin.name ?? 'anonymous');
  }

  /**
   * Disposes every plugin the manager installed: formula functions registered
   * through the API are unregistered and event subscriptions retired, so
   * `Spreadsheet.destroy()` leaves nothing behind.
   */
  public clear(): void {
    for (const api of this.apis) api.dispose();
    this.apis.length = 0;
    this.plugins.length = 0;
  }
}
