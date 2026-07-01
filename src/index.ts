export interface SpreadsheetOptions {
  readonly data?: readonly (readonly SpreadsheetCell[])[];
}

export interface SpreadsheetCell {
  readonly text: string;
}

export class Spreadsheet {
  private readonly root: HTMLElement;
  private readonly options: SpreadsheetOptions;

  public constructor(root: HTMLElement, options: SpreadsheetOptions = {}) {
    this.root = root;
    this.options = options;
  }

  public mount(): void {
    this.root.textContent = 'web-spreadsheet v2.0 scaffold';
  }

  public get rowCount(): number {
    return this.options.data?.length ?? 0;
  }
}

export { EventBus } from './events/EventBus';
export type { EventHandler, WildcardPayload } from './events/EventBus';
export { Store } from './store/Store';
export type { SerializedStore } from './store/Store';
export type { Cell, CellValue, ColMeta, RowMeta, StoreEvent, Style, Unsubscribe } from './types';
