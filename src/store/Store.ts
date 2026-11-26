import { SheetData, type SerializedSheetData } from './SheetData';

import { isSpillShadow } from '../util/spillShadow';
import { mapSheetRefs } from '../util/sheetRef';
import { TOTAL_COLS } from '../util/gridSize';
import type { Cell, ColMeta, RowMeta, StoreEvent, Style, Unsubscribe } from '../types';
import type { ConditionalRule } from '../conditional/ConditionalRule';
import type { ChartSpec, ImageSpec } from '../charts/types';
import type { CellRect, MergeRect, RowGroupDef, SheetFreeze } from './SheetData';
import type { ValidationRule } from '../validation/types';
import type { SparklineSpec } from '../sparkline/types';
import type { NamedRangeDef } from '../namedrange/types';
import type { SheetProtectionState } from '../protection/SheetProtection';
import type { AutoFilterState } from '../types';

export type { CellRect, MergeRect, SerializedSheetData } from './SheetData';

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
  /** Flush nesting: the outermost flush plus any batches its listeners open mid-flush. */
  private flushDepth = 0;
  private revisionCount = 0;
  private readonly batchEndListeners = new Set<() => void>();

  public constructor() {
    this.sheets.set(this.activeSheetId, new SheetData());
    this.sheetNames.set(this.activeSheetId, 'Sheet1');
  }

  /**
   * Changes each time an event is delivered. A cache keyed on it goes stale
   * with the store without having to subscribe (and without a subscription
   * to remember to drop).
   */
  public get revision(): number {
    return this.revisionCount;
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
    this.notify({ type: 'sheet', action: 'recolor', sheetId });
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
    // Not `activate`: the tab order moved, but the active sheet and its data
    // did not — subscribers must not treat this as a sheet switch.
    this.notify({ type: 'sheet', action: 'move', sheetId });
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
    // Cells (and feature specs) are shared by reference — every write
    // constructs a new object, so a copy can never observe a later edit.
    // Cloning skips serialize()'s string keys and structuredClone's walk.
    this.sheets.set(id, source.clone());
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
    // Spill shadows in the copy still name the SOURCE sheet's anchor; re-key
    // them, or the copy's own anchor sees its shadows as blockers (#SPILL!).
    const sourcePrefix = `${sheetId}:`;
    const rekey: Array<[number, number, Cell, string]> = [];
    this.forEachCell((r, c, cell) => {
      if (cell.spillOf === undefined || !cell.spillOf.startsWith(sourcePrefix)) return;
      rekey.push([r, c, cell, cell.spillOf.slice(sourcePrefix.length)]);
    }, id);
    for (const [r, c, cell, anchor] of rekey) {
      this.setCell(r, c, { ...cell, spillOf: `${id}:${anchor}` }, id);
    }
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

  /** Calls `fn` for every stored cell on the sheet; never walks empty addresses. */
  public forEachCell(fn: (r: number, c: number, cell: Cell) => void, sheetId = this.activeSheetId): void {
    this.requireSheet(sheetId).forEachCell(fn);
  }

  /** Calls `fn` for the stored cells inside `rect` only, at a cost that tracks
   * the rect area (up to the number of stored cells), not the address space. */
  public forEachCellInRect(rect: CellRect, fn: (r: number, c: number, cell: Cell) => void, sheetId = this.activeSheetId): void {
    this.requireSheet(sheetId).forEachCell(fn, rect);
  }

  /** Number of cells stored on the sheet (any Cell object, empty-text ones included). */
  public getCellCount(sheetId = this.activeSheetId): number {
    return this.requireSheet(sheetId).getCellCount();
  }

  /** The smallest rectangle around every stored cell; undefined when the sheet holds none. */
  public getUsedBounds(sheetId = this.activeSheetId): CellRect | undefined {
    return this.requireSheet(sheetId).getUsedBounds();
  }

  /**
   * The part of `range` worth walking: the range intersected with the sheet's
   * used bounds. When the two do not overlap the result is the range's first
   * cell alone — so an operation on an empty selection still has one cell to
   * work on and never walks the (Excel-sized) address space.
   */
  public limitToData(range: CellRect, sheetId = this.activeSheetId): CellRect {
    const r1 = Math.min(range.r1, range.r2);
    const c1 = Math.min(range.c1, range.c2);
    const r2 = Math.max(range.r1, range.r2);
    const c2 = Math.max(range.c1, range.c2);
    const bounds = this.getUsedBounds(sheetId);
    if (bounds === undefined) return { r1, c1, r2: r1, c2: c1 };
    const lo1 = Math.max(r1, bounds.r1);
    const lo2 = Math.max(c1, bounds.c1);
    const hi1 = Math.min(r2, bounds.r2);
    const hi2 = Math.min(c2, bounds.c2);
    if (lo1 > hi1 || lo2 > hi2) return { r1, c1, r2: r1, c2: c1 };
    if (lo1 === r1 && lo2 === c1 && hi1 === r2 && hi2 === c2) return range;
    return { r1: lo1, c1: lo2, r2: hi1, c2: hi2 };
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

  /**
   * The style in effect at (r, c): the cell's own format wins, then the row
   * default, then the column default (Excel: direct format > row format >
   * column format). Whole-column/whole-row formatting lives on the axis meta
   * (`colstyle-*` / `rowstyle-*` ids), so blank and future cells resolve
   * through here too. `cell` may be passed by callers that already hold it.
   */
  public getCellStyle(r: number, c: number, cell?: Cell | undefined, sheetId = this.activeSheetId): Style | undefined {
    const sheet = this.requireSheet(sheetId);
    const own = cell ?? sheet.getCell(r, c);
    if (own?.styleId !== undefined) {
      const style = sheet.getStyle(own.styleId);
      if (style !== undefined) return style;
    }
    const rowStyleId = sheet.getRow(r)?.styleId;
    if (rowStyleId !== undefined) {
      const style = sheet.getStyle(rowStyleId);
      if (style !== undefined) return style;
    }
    const colStyleId = sheet.getCol(c)?.styleId;
    if (colStyleId !== undefined) {
      const style = sheet.getStyle(colStyleId);
      if (style !== undefined) return style;
    }
    return undefined;
  }

  public getMerges(sheetId = this.activeSheetId): readonly string[] {
    return this.requireSheet(sheetId).getMerges();
  }

  /** Returns the merge covering (r,c) with parsed bounds, or undefined if none. */
  public getMergeRectAt(r: number, c: number, sheetId = this.activeSheetId): MergeRect | undefined {
    return this.requireSheet(sheetId).getMergeRectAt(r, c);
  }

  /** Returns the merge range string covering (r,c), or undefined if none. */
  public getMergeAt(r: number, c: number, sheetId = this.activeSheetId): string | undefined {
    return this.requireSheet(sheetId).getMergeRectAt(r, c)?.range;
  }

  public setCell(r: number, c: number, cell: Cell | undefined, sheetId = this.activeSheetId): void {
    this.requireSheet(sheetId).setCell(r, c, cell);
    this.notify(eventWithSheet({ type: 'cell', r, c, cell }, sheetId));
  }

  /** True once a formula cell has been written to the sheet (conservative latch; see SheetData). */
  public hasEverHadFormula(sheetId = this.activeSheetId): boolean {
    return this.requireSheet(sheetId).hasEverHadFormula();
  }

  /**
   * Insert `count` whole rows above `at`: the half-plane at/after `at` moves
   * down as one piece (spill shadows are dropped — the moved anchors re-spill
   * fresh), one `structure` event is delivered instead of one per cell.
   * Cells pushed past the grid edge come back for undo. Row/column metadata,
   * merges, formulas and features remain the caller's business (structural
   * commands).
   */
  public insertRows(at: number, count: number, sheetId = this.activeSheetId): Array<[number, Cell]> {
    const { dropped } = this.requireSheet(sheetId).shiftRows(at, count, isSpillShadow);
    this.notify(eventWithSheet({ type: 'structure', axis: 'row', kind: 'insert', start: at, count }, sheetId));
    return dropped;
  }

  /** Delete `count` whole rows starting at `start`: the band is taken out,
   * the rows below shift up as one piece, one `structure` event is
   * delivered. Returns the band's cells plus the shift's dropped ones
   * (spill shadows that refused to travel) — everything undo must put back. */
  public deleteRows(start: number, count: number, sheetId = this.activeSheetId): Array<[number, Cell]> {
    const sheet = this.requireSheet(sheetId);
    const removed = sheet.takeRows(start, start + count - 1);
    const { dropped } = sheet.shiftRows(start + count, -count, isSpillShadow);
    this.notify(eventWithSheet({ type: 'structure', axis: 'row', kind: 'delete', start, count }, sheetId));
    return [...removed, ...dropped];
  }

  /** Column counterpart of {@link insertRows}. */
  public insertCols(at: number, count: number, sheetId = this.activeSheetId): Array<[number, Cell]> {
    const { dropped } = this.requireSheet(sheetId).shiftCols(at, count, isSpillShadow);
    this.notify(eventWithSheet({ type: 'structure', axis: 'col', kind: 'insert', start: at, count }, sheetId));
    return dropped;
  }

  /** Column counterpart of {@link deleteRows}: returns the band's cells plus
   * the shift's dropped ones, for undo. */
  public deleteCols(start: number, count: number, sheetId = this.activeSheetId): Array<[number, Cell]> {
    const sheet = this.requireSheet(sheetId);
    const removed = sheet.takeCols(start, start + count - 1);
    const { dropped } = sheet.shiftCols(start + count, -count, isSpillShadow);
    this.notify(eventWithSheet({ type: 'structure', axis: 'col', kind: 'delete', start, count }, sheetId));
    return [...removed, ...dropped];
  }

  /**
   * Write a batch of cells and deliver ONE `cells` event. `keys` is stored
   * once per call and shared with every subscriber (the event holds the same
   * array — no per-cell keys, no per-subscriber copies). Cell objects are
   * stored by reference, as everywhere else.
   */
  public bulkSetCells(entries: ReadonlyArray<readonly [number, Cell]>, sheetId = this.activeSheetId): void {
    const sheet = this.requireSheet(sheetId);
    const keys: number[] = [];
    for (const [key, cell] of entries) {
      const r = Math.floor(key / TOTAL_COLS);
      sheet.setCell(r, key - r * TOTAL_COLS, cell);
      keys.push(key);
    }
    this.notify(eventWithSheet({ type: 'cells', keys }, sheetId));
  }

  /**
   * Take every stored cell inside `rect` out of the sheet and hand them back
   * as `[key, cell]` pairs (key = r * TOTAL_COLS + c). ONE `cells` event
   * announces the removal: clearing a million-cell column costs one sweep,
   * not a million writes and events — the clear's counterpart of the
   * structural primitives, and what its undo hands to `bulkSetCells`.
   */
  public takeCellsInRect(rect: CellRect, sheetId = this.activeSheetId): Array<[number, Cell]> {
    const taken = this.requireSheet(sheetId).takeRect(rect);
    if (taken.length > 0) this.notify(eventWithSheet({ type: 'cells', keys: taken.map(([key]) => key) }, sheetId));
    return taken;
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

  /** [index, meta] pairs of rows that carry metadata (new array, state untouched). */
  public getRowEntries(sheetId = this.activeSheetId): readonly [number, RowMeta][] {
    return this.requireSheet(sheetId).getRowEntries();
  }

  /** [index, meta] pairs of columns that carry metadata (new array, state untouched). */
  public getColEntries(sheetId = this.activeSheetId): readonly [number, ColMeta][] {
    return this.requireSheet(sheetId).getColEntries();
  }

  public getConditionalRules(sheetId = this.activeSheetId): readonly [string, ConditionalRule[]][] {
    return this.requireSheet(sheetId).getConditionalRules();
  }

  public setConditionalRule(range: string, rules: ConditionalRule[], sheetId = this.activeSheetId): void {
    this.requireSheet(sheetId).setConditionalRule(range, rules);
    this.notify(eventWithSheet({ type: 'conditionalRules', range }, sheetId));
  }

  public removeConditionalRule(range: string, sheetId = this.activeSheetId): void {
    this.requireSheet(sheetId).removeConditionalRule(range);
    this.notify(eventWithSheet({ type: 'conditionalRules', range }, sheetId));
  }

  public getCharts(sheetId = this.activeSheetId): readonly ChartSpec[] {
    return this.requireSheet(sheetId).getCharts();
  }

  public addChart(spec: ChartSpec, sheetId = this.activeSheetId): void {
    this.requireSheet(sheetId).addChart(spec);
    this.notify(eventWithSheet({ type: 'charts', id: spec.id }, sheetId));
  }

  public removeChart(id: string, sheetId = this.activeSheetId): void {
    this.requireSheet(sheetId).removeChart(id);
    this.notify(eventWithSheet({ type: 'charts', id }, sheetId));
  }

  public getImages(sheetId = this.activeSheetId): readonly ImageSpec[] {
    return this.requireSheet(sheetId).getImages();
  }

  public addImage(spec: ImageSpec, sheetId = this.activeSheetId): void {
    this.requireSheet(sheetId).addImage(spec);
    this.notify(eventWithSheet({ type: 'images', id: spec.id }, sheetId));
  }

  public removeImage(id: string, sheetId = this.activeSheetId): void {
    this.requireSheet(sheetId).removeImage(id);
    this.notify(eventWithSheet({ type: 'images', id }, sheetId));
  }

  public getFreeze(sheetId = this.activeSheetId): SheetFreeze | undefined {
    return this.requireSheet(sheetId).getFreeze();
  }

  public setFreeze(freeze: SheetFreeze | undefined, sheetId = this.activeSheetId): void {
    this.requireSheet(sheetId).setFreeze(freeze);
    this.notify(eventWithSheet({ type: 'freeze' }, sheetId));
  }

  public getRowGroups(sheetId = this.activeSheetId): readonly RowGroupDef[] {
    return this.requireSheet(sheetId).getRowGroups();
  }

  public setRowGroups(groups: readonly RowGroupDef[], sheetId = this.activeSheetId): void {
    this.requireSheet(sheetId).setRowGroups(groups);
    this.notify(eventWithSheet({ type: 'rowGroups' }, sheetId));
  }

  public getValidationRules(sheetId = this.activeSheetId): readonly [string, ValidationRule][] {
    return this.requireSheet(sheetId).getValidationRules();
  }

  public setValidationRule(range: string, rule: ValidationRule, sheetId = this.activeSheetId): void {
    this.requireSheet(sheetId).setValidationRule(range, rule);
    this.notify(eventWithSheet({ type: 'validations', range }, sheetId));
  }

  public removeValidationRule(range: string, sheetId = this.activeSheetId): void {
    this.requireSheet(sheetId).removeValidationRule(range);
    this.notify(eventWithSheet({ type: 'validations', range }, sheetId));
  }

  public getValidationRule(r: number, c: number, sheetId = this.activeSheetId): ValidationRule | undefined {
    return this.requireSheet(sheetId).getValidationRule(r, c);
  }

  public getSparklines(sheetId = this.activeSheetId): readonly SparklineSpec[] {
    return this.requireSheet(sheetId).getSparklines();
  }

  public addSparkline(spec: SparklineSpec, sheetId = this.activeSheetId): void {
    this.requireSheet(sheetId).addSparkline(spec);
    this.notify(eventWithSheet({ type: 'sparklines', id: spec.id }, sheetId));
  }

  public removeSparkline(id: string, sheetId = this.activeSheetId): void {
    this.requireSheet(sheetId).removeSparkline(id);
    this.notify(eventWithSheet({ type: 'sparklines', id }, sheetId));
  }

  public getSparklineAt(r: number, c: number, sheetId = this.activeSheetId): SparklineSpec | undefined {
    return this.requireSheet(sheetId).getSparklineAt(r, c);
  }

  public getNamedRanges(sheetId = this.activeSheetId): readonly [string, NamedRangeDef][] {
    return this.requireSheet(sheetId).getNamedRanges();
  }

  public setNamedRange(name: string, def: NamedRangeDef, sheetId = this.activeSheetId): void {
    this.requireSheet(sheetId).setNamedRange(name, def);
    this.notify(eventWithSheet({ type: 'namedRanges', name }, sheetId));
  }

  public removeNamedRange(name: string, sheetId = this.activeSheetId): void {
    this.requireSheet(sheetId).removeNamedRange(name);
    this.notify(eventWithSheet({ type: 'namedRanges', name }, sheetId));
  }

  public getNamedRange(name: string, sheetId = this.activeSheetId): NamedRangeDef | undefined {
    return this.requireSheet(sheetId).getNamedRange(name);
  }

  public getProtection(sheetId = this.activeSheetId): SheetProtectionState | undefined {
    return this.requireSheet(sheetId).getProtection();
  }

  public setProtection(state: SheetProtectionState | undefined, sheetId = this.activeSheetId): void {
    this.requireSheet(sheetId).setProtection(state);
    this.notify(eventWithSheet({ type: 'protection' }, sheetId));
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
        this.flushDepth += 1;
        try {
          const events = [...this.batchedEvents.values()];
          this.batchedEvents.clear();
          events.forEach((event) => this.notifyNow(event));
          this.batchEndListeners.forEach((fn2) => fn2());
        } finally {
          this.flushDepth -= 1;
        }
      }
    }
  }

  /**
   * True while a batch's coalesced events are being delivered to subscribers.
   * Counted, not flagged: a batchEnd listener opening a batch mid-flush (spill
   * writes) ends that batch while the outermost flush is still in progress,
   * and its remaining events must still read as flushing.
   */
  public isFlushing(): boolean {
    return this.flushDepth > 0;
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
    // Workbook-wide setting: no sheetId, unlike every sheet-scoped event.
    this.notify({ type: 'workbookPassword' });
  }

  /**
   * Hot-swap the whole workbook (file import). Sheet data is replaced in
   * place so existing subscribers keep working; the caller clears the undo
   * history afterwards (Excel cannot undo opening a file either).
   */
  public replaceAll(data: SerializedStore): void {
    if (data.sheets.length === 0) throw new Error('replaceAll requires at least one sheet');
    // Atomic swap: deserialize EVERY sheet before touching the live maps. A
    // corrupt sheet (e.g. an autosave blob from a half-dead HMR page, missing
    // `cells`) used to abort mid-way — after sheets.clear() but before the
    // activeSheetId fixup — leaving the store permanently inconsistent
    // ("Unknown sheet" on every subsequent read) with the error swallowed by
    // the caller's catch.
    const rebuilt = data.sheets.map((sheet) => ({ sheet, data: SheetData.deserialize(sheet.data) }));
    const next = data.sheets;
    this.batch(() => {
      const oldIds = [...this.sheets.keys()];
      this.sheets.clear();
      this.sheetNames.clear();
      this.sheetColors.clear();
      for (const { sheet, data: deserialized } of rebuilt) {
        this.sheets.set(sheet.id, deserialized);
        this.sheetNames.set(sheet.id, sheet.name);
        if (sheet.color !== undefined && sheet.color !== '') this.sheetColors.set(sheet.id, sheet.color);
      }
      const ids = new Set(this.sheets.keys());
      this.activeSheetId = ids.has(data.activeSheetId) ? data.activeSheetId : (this.sheets.keys().next().value as string);
      this.nextSheetNumber = this.sheets.size + 1;
      // Announced first: subscribers holding per-cell state (the formula
      // engine's registrations) rebuild from the final state instead of
      // patching it — cells the new workbook lacks never emit an event, so
      // patching would leave their old registrations behind as ghosts.
      this.notify({ type: 'workbook', action: 'replace' });
      oldIds.forEach((sheetId) => { if (!ids.has(sheetId)) this.notify({ type: 'sheet', action: 'delete', sheetId }); });
      next.forEach((sheet) => { this.notify({ type: 'sheet', action: 'add', sheetId: sheet.id, name: sheet.name }); });
      this.notify({ type: 'sheet', action: 'activate', sheetId: this.activeSheetId });
      // No per-cell replay: the formula sync layer rebuilds from the final
      // state on `workbook replace` (reloadFromStore at batch end), the
      // renderer re-syncs row/col sizes and invalidates on `sheet activate`,
      // and the React shell refreshes on `workbook`/`sheet`. A million-cell
      // import must not allocate a million event objects.
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
    // Before delivery: a reader that saw the new number has seen this event.
    this.revisionCount += 1;
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
      // Collect first, write after: setCell mutates the map forEachCell walks.
      const hits: Array<[number, number, Cell]> = [];
      this.forEachCell((r, c, cell) => {
        const formula = cell.formula ?? (cell.text.startsWith('=') ? cell.text : undefined);
        if (formula === undefined) return;
        if (mapSheetRefs(formula, previous, next) === formula) return;
        hits.push([r, c, cell]);
      }, id);
      for (const [r, c, cell] of hits) {
        const formula = cell.formula ?? cell.text;
        const rewritten = mapSheetRefs(formula, previous, next);
        const nextCell: Cell = { ...cell, text: rewritten };
        delete nextCell.value;
        if (rewritten.startsWith('=')) nextCell.formula = rewritten;
        else delete nextCell.formula;
        this.setCell(r, c, nextCell, id);
      }
    }
  }

  /** Re-emit formula cells so the formula engine registers the copy. */
  private replayFormulaCells(sheetId: string): void {
    const hits: Array<[number, number, Cell]> = [];
    this.forEachCell((r, c, cell) => {
      if (cell.formula === undefined && !cell.text.startsWith('=')) return;
      hits.push([r, c, cell]);
    }, sheetId);
    for (const [r, c, cell] of hits) this.setCell(r, c, { ...cell }, sheetId);
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
  const sheet = 'sheetId' in e ? (e.sheetId ?? 'sheet-1') : 'sheet-1';
  switch (e.type) {
    case 'cell': return `cell:${sheet}:${e.r},${e.c}`;
    case 'row': return `row:${sheet}:${e.r}`;
    case 'col': return `col:${sheet}:${e.c}`;
    case 'style': return `style:${sheet}:${e.id}`;
    case 'merge': return `merge:${sheet}:${e.range}`;
    // Identity-bearing feature events merge per (type, sheet, identity) —
    // the same granularity the old disguised `style` events coalesced by.
    case 'conditionalRules': return `conditionalRules:${sheet}:${e.range}`;
    case 'charts': return `charts:${sheet}:${e.id}`;
    case 'images': return `images:${sheet}:${e.id}`;
    case 'sparklines': return `sparklines:${sheet}:${e.id}`;
    case 'validations': return `validations:${sheet}:${e.range}`;
    case 'namedRanges': return `namedRanges:${sheet}:${e.name}`;
    // rowGroups / freeze / protection / workbookPassword carry no identity:
    // each write is delivered in order, never merged.
    default: return undefined;
  }
}

export interface SerializedStore {
  readonly activeSheetId: string;
  readonly sheets: Array<{ readonly id: string; readonly name: string; readonly color?: string; readonly data: SerializedSheetData }>;
  /** SHA-256 hex of the workbook password; empty when no password is set. */
  readonly passwordHash?: string | undefined;
}
