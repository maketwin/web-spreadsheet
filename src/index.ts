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
