import type { Spreadsheet } from '../components/Spreadsheet';
import { PluginAPI } from './PluginAPI';

export interface Plugin {
  readonly name?: string;
  install: (api: PluginAPI) => void;
}

export class PluginManager {
  private readonly plugins: Plugin[] = [];

  public constructor(private readonly ss: Spreadsheet) {}

  public use(plugin: Plugin): this {
    const api = new PluginAPI(this.ss);
    plugin.install(api);
    this.plugins.push(plugin);
    return this;
  }

  public list(): readonly string[] {
    return this.plugins.map((plugin) => plugin.name ?? 'anonymous');
  }

  public clear(): void {
    this.plugins.length = 0;
  }
}
