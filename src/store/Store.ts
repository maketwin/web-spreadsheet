import type { Cell, ColMeta, RowMeta, StoreEvent, Style, Unsubscribe } from '../types';

export class Store {
  private cells = new Map<string, Cell>();
  private rows = new Map<number, RowMeta>();
  private cols = new Map<number, ColMeta>();
  private styles = new Map<string, Style>();
  private merges = new Set<string>();
  private subscribers = new Set<(e: StoreEvent) => void>();

  public getCell(r: number, c: number): Cell | undefined {
    return this.cells.get(`${r},${c}`);
  }

  public getRow(r: number): RowMeta | undefined {
    return this.rows.get(r);
  }

  public getCol(c: number): ColMeta | undefined {
    return this.cols.get(c);
  }

  public getStyle(id: string): Style | undefined {
    return this.styles.get(id);
  }

  public getMerges(): readonly string[] {
    return [...this.merges];
  }

  public setCell(r: number, c: number, cell: Cell | undefined): void {
    const key = `${r},${c}`;
    if (cell == null) {
      this.cells.delete(key);
    } else {
      this.cells.set(key, cell);
    }
    this.notify({ type: 'cell', r, c, cell });
  }

  public setRow(r: number, meta: RowMeta | undefined): void {
    if (meta == null) {
      this.rows.delete(r);
    } else {
      this.rows.set(r, meta);
    }
    this.notify({ type: 'row', r, meta });
  }

  public setCol(c: number, meta: ColMeta | undefined): void {
    if (meta == null) {
      this.cols.delete(c);
    } else {
      this.cols.set(c, meta);
    }
    this.notify({ type: 'col', c, meta });
  }

  public setStyle(id: string, style: Style | undefined): void {
    if (style == null) {
      this.styles.delete(id);
    } else {
      this.styles.set(id, style);
    }
    this.notify({ type: 'style', id, style });
  }

  public addMerge(range: string): void {
    this.merges.add(range);
    this.notify({ type: 'merge', range });
  }

  public removeMerge(range: string): void {
    this.merges.delete(range);
    this.notify({ type: 'merge', range });
  }

  public subscribe(fn: (e: StoreEvent) => void): Unsubscribe {
    this.subscribers.add(fn);
    return () => {
      this.subscribers.delete(fn);
    };
  }

  private notify(e: StoreEvent): void {
    this.subscribers.forEach((fn) => fn(e));
  }

  public serialize(): SerializedStore {
    return {
      cells: [...this.cells.entries()],
      rows: [...this.rows.entries()],
      cols: [...this.cols.entries()],
      styles: [...this.styles.entries()],
      merges: [...this.merges],
    };
  }

  public static deserialize(data: SerializedStore): Store {
    const store = new Store();
    data.cells.forEach(([key, value]) => store.cells.set(key, value));
    data.rows.forEach(([key, value]) => store.rows.set(key, value));
    data.cols.forEach(([key, value]) => store.cols.set(key, value));
    data.styles.forEach(([key, value]) => store.styles.set(key, value));
    data.merges.forEach((merge) => store.merges.add(merge));
    return store;
  }
}

export interface SerializedStore {
  cells: Array<[string, Cell]>;
  rows: Array<[number, RowMeta]>;
  cols: Array<[number, ColMeta]>;
  styles: Array<[string, Style]>;
  merges: string[];
}
