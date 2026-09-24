import { SheetData, type SerializedSheetData } from './SheetData';

import { parseRange } from '../util/cell';
import { mapSheetRefs } from '../util/sheetRef';
import type { Cell, ColMeta, RowMeta, StoreEvent, Style, Unsubscribe } from '../types';
import type { ConditionalRule } from '../conditional/ConditionalRule';
import type { ChartSpec, ImageSpec } from '../charts/types';
import type { RowGroupDef } from './SheetData';
import type { ValidationRule } from '../validation/types';
import type { SparklineSpec } from '../sparkline/types';
import type { NamedRangeDef } from '../namedrange/types';
import type { SheetProtectionState } from '../protection/SheetProtection';
import type { AutoFilterState } from '../types';

export interface SheetInfo {
  readonly id: string;
  readonly name: string;
  /** Excel sheet-tab tint (optional CSS color). */
  readonly color?: string;
}

export class Store {
  private readonly sheets = new Map<string, SheetData>();
  private readonly sheetNames = new Map<string, string>();
  private readonly sheetColors = new Map<string, string>();
  private workbookPasswordHash: string | undefined;
  private readonly subscribers = new Set<(e: StoreEvent) => void>();
  private activeSheetId = 'sheet-1';
  private nextSheetNumber = 2;
  private batchDepth = 0;
  private batchedEvents = new Map<string, StoreEvent>();
  private batchSeq = 0;
  private flushing = false;
  private readonly batchEndListeners = new Set<() => void>();

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
    return [...this.sheets.keys()].map((id) => {
      const color = this.sheetColors.get(id);
      return color === undefined ? { id, name: this.sheetNames.get(id) ?? id } : { id, name: this.sheetNames.get(id) ?? id, color };
    });
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
    const previous = this.sheetNames.get(sheetId) ?? '';
    if (previous === trimmed) return true;
    for (const [id, existing] of this.sheetNames) {
      if (id !== sheetId && existing.toLowerCase() === trimmed.toLowerCase()) return false;
    }
    this.sheetNames.set(sheetId, trimmed);
    if (previous !== trimmed) this.rewriteSheetRefs(previous, trimmed);
    this.notify({ type: 'sheet', action: 'rename', sheetId, name: trimmed });
    return true;
  }

  public setSheetColor(sheetId: string, color: string | undefined): boolean {
    if (!this.sheets.has(sheetId)) return false;
    if (color === undefined || color.trim() === '') this.sheetColors.delete(sheetId);
    else this.sheetColors.set(sheetId, color.trim());
    this.notify({ type: 'sheet', action: 'rename', sheetId, name: this.sheetNames.get(sheetId) ?? sheetId });
    return true;
  }

  /** Reorder sheets; `toIndex` is the destination index in the current tab order. */
  public moveSheet(sheetId: string, toIndex: number): boolean {
    const ids = [...this.sheets.keys()];
    const from = ids.indexOf(sheetId);
    if (from < 0) return false;
    const clamped = Math.max(0, Math.min(toIndex, ids.length - 1));
    if (from === clamped) return true;
    ids.splice(from, 1);
    ids.splice(clamped, 0, sheetId);
    const nextSheets = new Map<string, SheetData>();
    const nextNames = new Map<string, string>();
    const nextColors = new Map<string, string>();
    for (const id of ids) {
      nextSheets.set(id, this.sheets.get(id)!);
      nextNames.set(id, this.sheetNames.get(id) ?? id);
      const color = this.sheetColors.get(id);
      if (color !== undefined) nextColors.set(id, color);
    }
    this.sheets.clear();
    this.sheetNames.clear();
    this.sheetColors.clear();
    for (const [id, data] of nextSheets) this.sheets.set(id, data);
    for (const [id, name] of nextNames) this.sheetNames.set(id, name);
    for (const [id, color] of nextColors) this.sheetColors.set(id, color);
    this.notify({ type: 'sheet', action: 'activate', sheetId: this.activeSheetId });
    return true;
  }

  /**
   * Excel 「移动或复制」→ 建立副本：深拷贝整张表（含单元格/样式/合并等 serialize 字段）。
   * Inserts the copy before `beforeSheetId`, or at end when omitted / not found.
   */
  public copySheet(sheetId: string, opts?: { readonly name?: string; readonly beforeSheetId?: string }): string | undefined {
    if (!this.sheets.has(sheetId)) return undefined;
    const source = this.requireSheet(sheetId);
    const sourceName = this.sheetNames.get(sheetId) ?? 'Sheet';
    const name = opts?.name?.trim()
      ? this.uniqueSheetName(opts.name.trim())
      : this.uniqueCopyName(sourceName);
    const id = this.makeSheetId();
    // serialize() keeps live object references; clone before the copy shares them.
    this.sheets.set(id, SheetData.deserialize(structuredClone(source.serialize())));
    this.sheetNames.set(id, name);
    const color = this.sheetColors.get(sheetId);
    if (color !== undefined) this.sheetColors.set(id, color);
    // Reorder: place new id before beforeSheetId (or at end).
    const ids = [...this.sheets.keys()].filter((x) => x !== id);
    const before = opts?.beforeSheetId;
    const at = before !== undefined ? ids.indexOf(before) : -1;
    if (at >= 0) ids.splice(at, 0, id);
    else ids.push(id);
    const nextSheets = new Map<string, SheetData>();
    const nextNames = new Map<string, string>();
    const nextColors = new Map<string, string>();
    for (const sid of ids) {
      nextSheets.set(sid, this.sheets.get(sid)!);
      nextNames.set(sid, this.sheetNames.get(sid) ?? sid);
      const c = this.sheetColors.get(sid);
      if (c !== undefined) nextColors.set(sid, c);
    }
    this.sheets.clear();
    this.sheetNames.clear();
    this.sheetColors.clear();
    for (const [sid, data] of nextSheets) this.sheets.set(sid, data);
    for (const [sid, n] of nextNames) this.sheetNames.set(sid, n);
    for (const [sid, c] of nextColors) this.sheetColors.set(sid, c);
    this.activeSheetId = id;
    this.replayFormulaCells(id);
    this.notify({ type: 'sheet', action: 'add', sheetId: id, name });
    return id;
  }

  /** Ensure sheet display name is unique (append " (n)" if taken). */
  public uniqueSheetName(desired: string): string {
    const names = new Set(this.sheetNames.values());
    if (!names.has(desired)) return desired;
    for (let n = 2; n < 10_000; n += 1) {
      const candidate = `${desired} (${n})`;
      if (!names.has(candidate)) return candidate;
    }
    return `${desired} (${Date.now()})`;
  }

  /** Excel copy naming: "Sheet1" → "Sheet1 (2)", then "Sheet1 (3)", … */
  public uniqueCopyName(sourceName: string): string {
    const names = new Set(this.sheetNames.values());
    for (let n = 2; n < 10_000; n += 1) {
      const candidate = `${sourceName} (${n})`;
      if (!names.has(candidate)) return candidate;
    }
    return `${sourceName} (${Date.now()})`;
  }

  public deleteSheet(sheetId: string): boolean {
    if (this.sheets.size <= 1 || !this.sheets.has(sheetId)) return false;
    const removedName = this.sheetNames.get(sheetId);
    this.sheets.delete(sheetId);
    this.sheetNames.delete(sheetId);
    this.sheetColors.delete(sheetId);
    if (this.activeSheetId === sheetId) this.activeSheetId = this.sheets.keys().next().value as string;
    if (removedName !== undefined) this.rewriteSheetRefs(removedName, null);
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

  public getCharts(sheetId = this.activeSheetId): readonly ChartSpec[] {
    return this.requireSheet(sheetId).getCharts();
  }

  public addChart(spec: ChartSpec, sheetId = this.activeSheetId): void {
    this.requireSheet(sheetId).addChart(spec);
    this.notify(eventWithSheet({ type: 'style' as const, id: `chart:${spec.id}`, style: undefined }, sheetId));
  }

  public removeChart(id: string, sheetId = this.activeSheetId): void {
    this.requireSheet(sheetId).removeChart(id);
    this.notify(eventWithSheet({ type: 'style' as const, id: `chart:${id}`, style: undefined }, sheetId));
  }

  public getImages(sheetId = this.activeSheetId): readonly ImageSpec[] {
    return this.requireSheet(sheetId).getImages();
  }

  public addImage(spec: ImageSpec, sheetId = this.activeSheetId): void {
    this.requireSheet(sheetId).addImage(spec);
    this.notify(eventWithSheet({ type: 'style' as const, id: `image:${spec.id}`, style: undefined }, sheetId));
  }

  public removeImage(id: string, sheetId = this.activeSheetId): void {
    this.requireSheet(sheetId).removeImage(id);
    this.notify(eventWithSheet({ type: 'style' as const, id: `image:${id}`, style: undefined }, sheetId));
  }

  public getRowGroups(sheetId = this.activeSheetId): readonly RowGroupDef[] {
    return this.requireSheet(sheetId).getRowGroups();
  }

  public setRowGroups(groups: readonly RowGroupDef[], sheetId = this.activeSheetId): void {
    this.requireSheet(sheetId).setRowGroups(groups);
    this.notify(eventWithSheet({ type: 'style' as const, id: 'rowGroups', style: undefined }, sheetId));
  }

  public getValidationRules(sheetId = this.activeSheetId): readonly [string, ValidationRule][] {
    return this.requireSheet(sheetId).getValidationRules();
  }

  public setValidationRule(range: string, rule: ValidationRule, sheetId = this.activeSheetId): void {
    this.requireSheet(sheetId).setValidationRule(range, rule);
    this.notify(eventWithSheet({ type: 'style' as const, id: `dv:${range}`, style: undefined }, sheetId));
  }

  public removeValidationRule(range: string, sheetId = this.activeSheetId): void {
    this.requireSheet(sheetId).removeValidationRule(range);
    this.notify(eventWithSheet({ type: 'style' as const, id: `dv:${range}`, style: undefined }, sheetId));
  }

  public getValidationRule(r: number, c: number, sheetId = this.activeSheetId): ValidationRule | undefined {
    return this.requireSheet(sheetId).getValidationRule(r, c);
  }

  public getSparklines(sheetId = this.activeSheetId): readonly SparklineSpec[] {
    return this.requireSheet(sheetId).getSparklines();
  }

  public addSparkline(spec: SparklineSpec, sheetId = this.activeSheetId): void {
    this.requireSheet(sheetId).addSparkline(spec);
    this.notify(eventWithSheet({ type: 'style' as const, id: `sparkline:${spec.id}`, style: undefined }, sheetId));
  }

  public removeSparkline(id: string, sheetId = this.activeSheetId): void {
    this.requireSheet(sheetId).removeSparkline(id);
    this.notify(eventWithSheet({ type: 'style' as const, id: `sparkline:${id}`, style: undefined }, sheetId));
  }

  public getSparklineAt(r: number, c: number, sheetId = this.activeSheetId): SparklineSpec | undefined {
    return this.requireSheet(sheetId).getSparklineAt(r, c);
  }

  public getNamedRanges(sheetId = this.activeSheetId): readonly [string, NamedRangeDef][] {
    return this.requireSheet(sheetId).getNamedRanges();
  }

  public setNamedRange(name: string, def: NamedRangeDef, sheetId = this.activeSheetId): void {
    this.requireSheet(sheetId).setNamedRange(name, def);
    this.notify(eventWithSheet({ type: 'style' as const, id: `nr:${name}`, style: undefined }, sheetId));
  }

  public removeNamedRange(name: string, sheetId = this.activeSheetId): void {
    this.requireSheet(sheetId).removeNamedRange(name);
    this.notify(eventWithSheet({ type: 'style' as const, id: `nr:${name}`, style: undefined }, sheetId));
  }

  public getNamedRange(name: string, sheetId = this.activeSheetId): NamedRangeDef | undefined {
    return this.requireSheet(sheetId).getNamedRange(name);
  }

  public getProtection(sheetId = this.activeSheetId): SheetProtectionState | undefined {
    return this.requireSheet(sheetId).getProtection();
  }

  public setProtection(state: SheetProtectionState | undefined, sheetId = this.activeSheetId): void {
    this.requireSheet(sheetId).setProtection(state);
    this.notify(eventWithSheet({ type: 'style' as const, id: 'protection', style: undefined }, sheetId));
  }

  public isSheetProtected(sheetId = this.activeSheetId): boolean {
    return this.requireSheet(sheetId).getProtection()?.protected === true;
  }

  public getAutoFilter(sheetId = this.activeSheetId): AutoFilterState | undefined {
    return this.requireSheet(sheetId).getAutoFilter();
  }

  public setAutoFilter(state: AutoFilterState | undefined, sheetId = this.activeSheetId): void {
    this.requireSheet(sheetId).setAutoFilter(state);
    this.notify({ type: 'autofilter', sheetId });
  }

  public subscribe(fn: (e: StoreEvent) => void): Unsubscribe {
    this.subscribers.add(fn);
    return () => {
      this.subscribers.delete(fn);
    };
  }

  /**
   * Run `fn` with subscriber notifications deferred. Events are coalesced
   * per target (last write wins) and delivered once after the batch, so
   * bulk mutations such as sorting never expose half-updated state to
   * formula recalculation or rendering.
   */
  public batch(fn: () => void): void {
    this.batchDepth += 1;
    try {
      fn();
    } finally {
      this.batchDepth -= 1;
      if (this.batchDepth === 0 && this.batchedEvents.size > 0) {
        this.flushing = true;
        try {
          const events = [...this.batchedEvents.values()];
          this.batchedEvents.clear();
          events.forEach((event) => this.notifyNow(event));
          this.batchEndListeners.forEach((fn2) => fn2());
        } finally {
          this.flushing = false;
        }
      }
    }
  }

  /** True while a batch's coalesced events are being delivered to subscribers. */
  public isFlushing(): boolean {
    return this.flushing;
  }

  /** Invoked after a batch's coalesced events are delivered; never mid-batch. */
  public onBatchEnd(fn: () => void): Unsubscribe {
    this.batchEndListeners.add(fn);
    return () => {
      this.batchEndListeners.delete(fn);
    };
  }

  public serialize(): SerializedStore {
    return {
      activeSheetId: this.activeSheetId,
      passwordHash: this.workbookPasswordHash,
      sheets: this.getSheets().map(({ id, name, color }) => (
        color === undefined
          ? { id, name, data: this.requireSheet(id).serialize() }
          : { id, name, color, data: this.requireSheet(id).serialize() }
      )),
    };
  }

  public getWorkbookPasswordHash(): string | undefined {
    return this.workbookPasswordHash;
  }

  public setWorkbookPasswordHash(hash: string | undefined): void {
    this.workbookPasswordHash = hash;
    this.notify({ type: 'style' as const, id: 'workbookPassword', style: undefined });
  }

  /**
   * Hot-swap the whole workbook (file import). Sheet data is replaced in
   * place so existing subscribers keep working; the caller clears the undo
   * history afterwards (Excel cannot undo opening a file either).
   */
  public replaceAll(data: SerializedStore): void {
    if (data.sheets.length === 0) throw new Error('replaceAll requires at least one sheet');
    const next = data.sheets;
    this.batch(() => {
      const oldIds = [...this.sheets.keys()];
      this.sheets.clear();
      this.sheetNames.clear();
      this.sheetColors.clear();
      for (const sheet of next) {
        this.sheets.set(sheet.id, SheetData.deserialize(sheet.data));
        this.sheetNames.set(sheet.id, sheet.name);
        if (sheet.color !== undefined && sheet.color !== '') this.sheetColors.set(sheet.id, sheet.color);
      }
      const ids = new Set(this.sheets.keys());
      this.activeSheetId = ids.has(data.activeSheetId) ? data.activeSheetId : (this.sheets.keys().next().value as string);
      this.nextSheetNumber = this.sheets.size + 1;
      oldIds.forEach((sheetId) => { if (!ids.has(sheetId)) this.notify({ type: 'sheet', action: 'delete', sheetId }); });
      next.forEach((sheet) => this.notify({ type: 'sheet', action: 'add', sheetId: sheet.id, name: sheet.name }));
      this.notify({ type: 'sheet', action: 'activate', sheetId: this.activeSheetId });
      // Replay content events so subscribers (formula engine, renderer scroll
      // sizes) observe the swapped-in data — sheet events alone leave the
      // formula dependency graph empty and imported formulas never recalc.
      for (const sheet of next) {
        const d = sheet.data;
        d.cells.forEach(([key, cell]) => {
          const [r, c] = key.split(',').map(Number);
          this.notify(eventWithSheet({ type: 'cell', r: r ?? 0, c: c ?? 0, cell }, sheet.id));
        });
        d.rows.forEach(([r, meta]) => this.notify(eventWithSheet({ type: 'row', r, meta }, sheet.id)));
        d.cols.forEach(([c, meta]) => this.notify(eventWithSheet({ type: 'col', c, meta }, sheet.id)));
        d.styles.forEach(([id, style]) => this.notify(eventWithSheet({ type: 'style', id, style }, sheet.id)));
        d.merges.forEach((range) => this.notify(eventWithSheet({ type: 'merge', range }, sheet.id)));
      }
    });
  }

  public static deserialize(data: SerializedStore): Store {
    const store = new Store();
    store.sheets.clear();
    store.sheetNames.clear();
    store.sheetColors.clear();
    data.sheets.forEach((sheet) => {
      store.sheets.set(sheet.id, SheetData.deserialize(sheet.data));
      store.sheetNames.set(sheet.id, sheet.name);
      if (sheet.color !== undefined && sheet.color !== '') store.sheetColors.set(sheet.id, sheet.color);
    });
    store.activeSheetId = store.sheets.has(data.activeSheetId) ? data.activeSheetId : (store.sheets.keys().next().value as string);
    store.nextSheetNumber = store.sheets.size + 1;
    return store;
  }

  private notify(e: StoreEvent): void {
    if (this.batchDepth === 0) {
      this.notifyNow(e);
      return;
    }
    const key = eventKey(e);
    this.batchedEvents.set(key === undefined ? `\0${this.batchSeq += 1}` : key, e);
  }

  private notifyNow(e: StoreEvent): void {
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

  /** Point every formula at the renamed sheet, or `#REF!` when `next` is null (sheet deleted). */
  private rewriteSheetRefs(previous: string, next: string | null): void {
    for (const id of this.sheets.keys()) {
      for (const [key, cell] of this.getCells(id)) {
        const formula = cell.formula ?? (cell.text.startsWith('=') ? cell.text : undefined);
        if (formula === undefined) continue;
        const rewritten = mapSheetRefs(formula, previous, next);
        if (rewritten === formula) continue;
        const sep = key.indexOf(',');
        const nextCell: Cell = { ...cell, text: rewritten };
        delete nextCell.value;
        if (rewritten.startsWith('=')) nextCell.formula = rewritten;
        else delete nextCell.formula;
        this.setCell(Number(key.slice(0, sep)), Number(key.slice(sep + 1)), nextCell, id);
      }
    }
  }

  /** Re-emit formula cells so the formula engine registers the copy. */
  private replayFormulaCells(sheetId: string): void {
    for (const [key, cell] of this.getCells(sheetId)) {
      if (cell.formula === undefined && !cell.text.startsWith('=')) continue;
      const sep = key.indexOf(',');
      this.setCell(Number(key.slice(0, sep)), Number(key.slice(sep + 1)), { ...cell }, sheetId);
    }
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
  // Every event carries its sheet id — including sheet-1 — so subscribers
  // (formula sync, deferred recalc) never lose sheet identity when another
  // sheet is active.
  return { ...event, sheetId };
}

/** Coalescing key for deferred batch events; undefined events always fire in order. */
function eventKey(e: StoreEvent): string | undefined {
  const sheet = e.sheetId ?? 'sheet-1';
  switch (e.type) {
    case 'cell': return `cell:${sheet}:${e.r},${e.c}`;
    case 'row': return `row:${sheet}:${e.r}`;
    case 'col': return `col:${sheet}:${e.c}`;
    case 'style': return `style:${sheet}:${e.id}`;
    case 'merge': return `merge:${sheet}:${e.range}`;
    default: return undefined;
  }
}

export interface SerializedStore {
  readonly activeSheetId: string;
  readonly sheets: Array<{ readonly id: string; readonly name: string; readonly color?: string; readonly data: SerializedSheetData }>;
  /** SHA-256 hex of the workbook password; empty when no password is set. */
  readonly passwordHash?: string | undefined;
}
