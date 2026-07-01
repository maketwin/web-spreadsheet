import { SheetData, type SerializedSheetData } from './SheetData';

import { parseRange } from '../util/cell';
import type { Cell, ColMeta, RowMeta, StoreEvent, Style, Unsubscribe } from '../types';
import type { ConditionalRule } from '../conditional/ConditionalRule';

export interface SheetInfo {
  readonly id: string;
  readonly name: string;
}

export class Store {
  private readonly sheets = new Map<string, SheetData>();
  private readonly sheetNames = new Map<string, string>();
  private readonly subscribers = new Set<(e: StoreEvent) => void>();
  private activeSheetId = 'sheet-1';
  private nextSheetNumber = 2;

  public constructor() {
    this.sheets.set(this.activeSheetId, new SheetData());
    this.sheetNames.set(this.activeSheetId, 'Sheet1');
  }

  public getActiveSheetId(): string {
    return this.activeSheetId;
  }

  public getActiveSheetName(): string {
    return this.sheetNames.get(this.activeSheetId) ?? this.activeSheetId;
  }

  public getSheetData(sheetId = this.activeSheetId): SheetData | undefined {
    return this.sheets.get(sheetId);
  }

  public getSheets(): readonly SheetInfo[] {
    return [...this.sheets.keys()].map((id) => ({ id, name: this.sheetNames.get(id) ?? id }));
  }

  public activateSheet(sheetId: string): boolean {
    if (!this.sheets.has(sheetId)) return false;
    this.activeSheetId = sheetId;
    this.notify({ type: 'sheet', action: 'activate', sheetId });
    return true;
  }

  public addSheet(name = this.makeSheetName()): string {
    const id = this.makeSheetId();
    this.sheets.set(id, new SheetData());
    this.sheetNames.set(id, name);
    this.activeSheetId = id;
    this.notify({ type: 'sheet', action: 'add', sheetId: id, name });
    return id;
  }

  public renameSheet(sheetId: string, name: string): boolean {
    const trimmed = name.trim();
    if (trimmed.length === 0 || !this.sheets.has(sheetId)) return false;
    this.sheetNames.set(sheetId, trimmed);
    this.notify({ type: 'sheet', action: 'rename', sheetId, name: trimmed });
    return true;
  }

  public deleteSheet(sheetId: string): boolean {
    if (this.sheets.size <= 1 || !this.sheets.has(sheetId)) return false;
    this.sheets.delete(sheetId);
    this.sheetNames.delete(sheetId);
    if (this.activeSheetId === sheetId) this.activeSheetId = this.sheets.keys().next().value as string;
    this.notify({ type: 'sheet', action: 'delete', sheetId });
    return true;
  }

  public getCell(r: number, c: number, sheetId = this.activeSheetId): Cell | undefined {
    return this.requireSheet(sheetId).getCell(r, c);
  }

  public getCellBySheetName(name: string, r: number, c: number): Cell | undefined {
    const id = this.findSheetIdByName(name);
    return id === undefined ? undefined : this.getCell(r, c, id);
  }

  public getRow(r: number, sheetId = this.activeSheetId): RowMeta | undefined {
    return this.requireSheet(sheetId).getRow(r);
  }

  public getCol(c: number, sheetId = this.activeSheetId): ColMeta | undefined {
    return this.requireSheet(sheetId).getCol(c);
  }

  public getStyle(id: string, sheetId = this.activeSheetId): Style | undefined {
    return this.requireSheet(sheetId).getStyle(id);
  }

  public getMerges(sheetId = this.activeSheetId): readonly string[] {
    return this.requireSheet(sheetId).getMerges();
  }

  /** Returns the merge range string covering (r,c), or undefined if none. */
  public getMergeAt(r: number, c: number, sheetId = this.activeSheetId): string | undefined {
    const merges = this.requireSheet(sheetId).getMerges();
    for (const rangeStr of merges) {
      const { r1, c1, r2, c2 } = parseRange(rangeStr);
      if (r >= r1 && r <= r2 && c >= c1 && c <= c2) return rangeStr;
    }
    return undefined;
  }

  public setCell(r: number, c: number, cell: Cell | undefined, sheetId = this.activeSheetId): void {
    this.requireSheet(sheetId).setCell(r, c, cell);
    this.notify(eventWithSheet({ type: 'cell', r, c, cell }, sheetId));
  }

  public setRow(r: number, meta: RowMeta | undefined, sheetId = this.activeSheetId): void {
    this.requireSheet(sheetId).setRow(r, meta);
    this.notify(eventWithSheet({ type: 'row', r, meta }, sheetId));
  }

  public setCol(c: number, meta: ColMeta | undefined, sheetId = this.activeSheetId): void {
    this.requireSheet(sheetId).setCol(c, meta);
    this.notify(eventWithSheet({ type: 'col', c, meta }, sheetId));
  }

  public setStyle(id: string, style: Style | undefined, sheetId = this.activeSheetId): void {
    this.requireSheet(sheetId).setStyle(id, style);
    this.notify(eventWithSheet({ type: 'style', id, style }, sheetId));
  }

  public addMerge(range: string, sheetId = this.activeSheetId): void {
    this.requireSheet(sheetId).addMerge(range);
    this.notify(eventWithSheet({ type: 'merge', range }, sheetId));
  }

  public removeMerge(range: string, sheetId = this.activeSheetId): void {
    this.requireSheet(sheetId).removeMerge(range);
    this.notify(eventWithSheet({ type: 'merge', range }, sheetId));
  }

  public getCells(sheetId = this.activeSheetId): readonly [string, Cell][] {
    return this.requireSheet(sheetId).getCells();
  }

  public getConditionalRules(sheetId = this.activeSheetId): readonly [string, ConditionalRule[]][] {
    return this.requireSheet(sheetId).getConditionalRules();
  }

  public setConditionalRule(range: string, rules: ConditionalRule[], sheetId = this.activeSheetId): void {
    this.requireSheet(sheetId).setConditionalRule(range, rules);
    this.notify(eventWithSheet({ type: 'style' as const, id: `cf:${range}`, style: undefined }, sheetId));
  }

  public removeConditionalRule(range: string, sheetId = this.activeSheetId): void {
    this.requireSheet(sheetId).removeConditionalRule(range);
    this.notify(eventWithSheet({ type: 'style' as const, id: `cf:${range}`, style: undefined }, sheetId));
  }

  public subscribe(fn: (e: StoreEvent) => void): Unsubscribe {
    this.subscribers.add(fn);
    return () => {
      this.subscribers.delete(fn);
    };
  }

  public serialize(): SerializedStore {
    return {
      activeSheetId: this.activeSheetId,
      sheets: this.getSheets().map(({ id, name }) => ({ id, name, data: this.requireSheet(id).serialize() })),
    };
  }

  public static deserialize(data: SerializedStore): Store {
    const store = new Store();
    store.sheets.clear();
    store.sheetNames.clear();
    data.sheets.forEach((sheet) => {
      store.sheets.set(sheet.id, SheetData.deserialize(sheet.data));
      store.sheetNames.set(sheet.id, sheet.name);
    });
    store.activeSheetId = store.sheets.has(data.activeSheetId) ? data.activeSheetId : (store.sheets.keys().next().value as string);
    store.nextSheetNumber = store.sheets.size + 1;
    return store;
  }

  private notify(e: StoreEvent): void {
    this.subscribers.forEach((fn) => fn(e));
  }

  private requireSheet(sheetId: string): SheetData {
    const sheet = this.sheets.get(sheetId);
    if (sheet === undefined) throw new Error(`Unknown sheet: ${sheetId}`);
    return sheet;
  }

  private findSheetIdByName(name: string): string | undefined {
    for (const [id, sheetName] of this.sheetNames) {
      if (sheetName === name) return id;
    }
    return undefined;
  }

  private makeSheetId(): string {
    let id = `sheet-${this.nextSheetNumber}`;
    while (this.sheets.has(id)) {
      this.nextSheetNumber += 1;
      id = `sheet-${this.nextSheetNumber}`;
    }
    this.nextSheetNumber += 1;
    return id;
  }

  private makeSheetName(): string {
    let index = this.nextSheetNumber;
    let name = `Sheet${index}`;
    const existing = new Set(this.sheetNames.values());
    while (existing.has(name)) {
      index += 1;
      name = `Sheet${index}`;
    }
    return name;
  }
}

function eventWithSheet<T extends StoreEvent>(event: T, sheetId: string): T {
  return sheetId === 'sheet-1' ? event : { ...event, sheetId };
}

export interface SerializedStore {
  readonly activeSheetId: string;
  readonly sheets: Array<{ readonly id: string; readonly name: string; readonly data: SerializedSheetData }>;
}
