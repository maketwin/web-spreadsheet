import type { AutoFilterState, Cell, ColMeta, RowMeta, Style } from '../types';
import { parseInternalRange, parseRange } from '../util/rangeNotation';
import { TOTAL_COLS, TOTAL_ROWS } from '../util/gridSize';
import type { ConditionalRule } from '../conditional/ConditionalRule';
import type { ChartSpec, ImageSpec } from '../charts/types';
import type { ValidationRule } from '../validation/types';
import type { SparklineSpec } from '../sparkline/types';
import type { NamedRangeDef } from '../namedrange/types';
import type { SheetProtectionState } from '../protection/SheetProtection';

/** 行分组（大纲）：[start, end] 为 0-based 闭区间。 */
export interface RowGroupDef {
  readonly start: number;
  readonly end: number;
}

/** A rectangle of cells, inclusive on both ends (structurally the same as RangeAddress). */
export interface CellRect {
  readonly r1: number;
  readonly c1: number;
  readonly r2: number;
  readonly c2: number;
}

/** 冻结窗格：左上角保持可见的行数、列数。 */
export interface SheetFreeze {
  readonly rows: number;
  readonly cols: number;
}

export interface SerializedSheetData {
  readonly cells: Array<[string, Cell]>;
  readonly rows: Array<[number, RowMeta]>;
  readonly cols: Array<[number, ColMeta]>;
  readonly styles: Array<[string, Style]>;
  readonly merges: string[];
  readonly conditionalRules: Array<[string, ConditionalRule[]]>;
  readonly charts: ChartSpec[];
  readonly images: ImageSpec[];
  readonly validationRules: Array<[string, ValidationRule]>;
  readonly sparklines: SparklineSpec[];
  readonly namedRanges: Array<[string, NamedRangeDef]>;
  readonly rowGroups: RowGroupDef[];
  readonly protection?: SheetProtectionState | undefined;
  readonly autoFilter?: AutoFilterState | undefined;
  readonly freeze?: SheetFreeze | undefined;
}

/** A merge as stored: the raw range string plus its parsed bounds. Lookup
 * results are shared internal objects — callers must treat them as readonly. */
export interface MergeRect {
  readonly r1: number;
  readonly c1: number;
  readonly r2: number;
  readonly c2: number;
  readonly range: string;
}

/** Rows per merge-index band (`band = r >> MERGE_BAND_SHIFT`). */
const MERGE_BAND_SHIFT = 6;

export class SheetData {
  /** Cells keyed by `r * TOTAL_COLS + c` — a number, never a string. */
  private readonly cells = new Map<number, Cell>();
  private readonly rows = new Map<number, RowMeta>();
  private readonly cols = new Map<number, ColMeta>();
  private readonly styles = new Map<string, Style>();
  private readonly merges = new Set<string>();
  /** 64-row band → merges touching that band, in insertion order. */
  private readonly mergesByRow = new Map<number, MergeRect[]>();
  private readonly conditionalRules = new Map<string, ConditionalRule[]>();
  private readonly charts = new Map<string, ChartSpec>();
  private readonly images = new Map<string, ImageSpec>();
  private readonly validationRules = new Map<string, ValidationRule>();
  private readonly sparklines = new Map<string, SparklineSpec>();
  private readonly namedRanges = new Map<string, NamedRangeDef>();
  private rowGroups: RowGroupDef[] = [];
  private protection: SheetProtectionState | undefined;
  private autoFilter: AutoFilterState | undefined;
  private freeze: SheetFreeze | undefined;
  /** Used bounds: max row/col maintained on write; min re-derived lazily after a boundary delete. */
  private usedMinR = -1;
  private usedMinC = -1;
  private usedMaxR = -1;
  private usedMaxC = -1;
  private usedBoundsDirty = false;
  /**
   * Conservative "a formula cell was written here at some point" latch: the
   * first formula write flips it (writes before that skip the text check on
   * the hot path), nothing flips it back — a sheet where every formula was
   * deleted still scans once, which is fine. Lets structural passes skip
   * formula-free sheets with one field read.
   */
  private everHadFormula = false;

  /** True once a formula cell has been written to this sheet (conservative). */
  public hasEverHadFormula(): boolean {
    return this.everHadFormula;
  }

  public getCell(r: number, c: number): Cell | undefined {
    return this.cells.get(r * TOTAL_COLS + c);
  }

  public setCell(r: number, c: number, cell: Cell | undefined): void {
    const key = r * TOTAL_COLS + c;
    if (cell === undefined) {
      if (!this.cells.delete(key)) return;
      this.noteCellRemoval(r, c);
      return;
    }
    if (!this.everHadFormula && (cell.formula !== undefined || cell.text.startsWith('='))) {
      this.everHadFormula = true;
    }
    const wasEmpty = this.cells.size === 0;
    this.cells.set(key, cell);
    if (wasEmpty) {
      this.usedMinR = r;
      this.usedMinC = c;
      this.usedMaxR = r;
      this.usedMaxC = c;
      this.usedBoundsDirty = false;
      return;
    }
    if (r < this.usedMinR) this.usedMinR = r;
    if (c < this.usedMinC) this.usedMinC = c;
    if (r > this.usedMaxR) this.usedMaxR = r;
    if (c > this.usedMaxC) this.usedMaxC = c;
  }

  /** Number of cells stored on this sheet (any Cell object, empty-text ones included). */
  public getCellCount(): number {
    return this.cells.size;
  }

  /**
   * Take every stored cell in rows [r1, r2] out of the map and return it as
   * `[key, cell]` (key = r * TOTAL_COLS + c). One sweep to collect, one pass
   * to delete — no tuples built beyond the returned array, no sorting. The
   * used bounds go stale; the next read recomputes them.
   */
  public takeRows(r1: number, r2: number): Array<[number, Cell]> {
    const lo = Math.max(0, r1);
    const hi = Math.min(TOTAL_ROWS - 1, r2);
    const taken: Array<[number, Cell]> = [];
    if (lo > hi || this.cells.size === 0) return taken;
    for (const [key, cell] of this.cells) {
      const r = Math.floor(key / TOTAL_COLS);
      if (r >= lo && r <= hi) taken.push([key, cell]);
    }
    for (const [key] of taken) this.cells.delete(key);
    this.usedBoundsDirty = true;
    return taken;
  }

  /** Column counterpart of {@link takeRows}. */
  public takeCols(c1: number, c2: number): Array<[number, Cell]> {
    const lo = Math.max(0, c1);
    const hi = Math.min(TOTAL_COLS - 1, c2);
    const taken: Array<[number, Cell]> = [];
    if (lo > hi || this.cells.size === 0) return taken;
    for (const [key, cell] of this.cells) {
      const c = key - Math.floor(key / TOTAL_COLS) * TOTAL_COLS;
      if (c >= lo && c <= hi) taken.push([key, cell]);
    }
    for (const [key] of taken) this.cells.delete(key);
    this.usedBoundsDirty = true;
    return taken;
  }

  /**
   * Take every stored cell inside `rect` out of the map, as `[key, cell]`
   * pairs. Routed like {@link forEachCell}: a rectangle small next to the
   * stored population reads its own addresses, a vast one (a whole column)
   * filters one sweep — never the rectangle's area. The used bounds go stale;
   * the next read recomputes them.
   */
  public takeRect(rect: CellRect): Array<[number, Cell]> {
    const r1 = Math.max(0, Math.min(rect.r1, rect.r2));
    const r2 = Math.min(TOTAL_ROWS - 1, Math.max(rect.r1, rect.r2));
    const c1 = Math.max(0, Math.min(rect.c1, rect.c2));
    const c2 = Math.min(TOTAL_COLS - 1, Math.max(rect.c1, rect.c2));
    const taken: Array<[number, Cell]> = [];
    if (r1 > r2 || c1 > c2 || this.cells.size === 0) return taken;
    if (4 * (r2 - r1 + 1) * (c2 - c1 + 1) <= this.cells.size) {
      for (let r = r1; r <= r2; r += 1) {
        for (let c = c1; c <= c2; c += 1) {
          const key = r * TOTAL_COLS + c;
          const cell = this.cells.get(key);
          if (cell !== undefined) taken.push([key, cell]);
        }
      }
    } else {
      for (const [key, cell] of this.cells) {
        const r = Math.floor(key / TOTAL_COLS);
        if (r < r1 || r > r2) continue;
        const c = key - r * TOTAL_COLS;
        if (c < c1 || c > c2) continue;
        taken.push([key, cell]);
      }
    }
    for (const [key] of taken) this.cells.delete(key);
    if (taken.length > 0) this.usedBoundsDirty = true;
    return taken;
  }

  /**
   * Move every stored cell with `axis index >= at` by `delta` positions
   * (positive = down/right) in one piece. `drop` marks cells that are
   * discarded instead of moved (spill shadows: derived state the anchor
   * re-spills); cells pushed past the grid edge are dropped too. Both kinds
   * come back as `[original key, cell]` for undo. All moving keys are
   * deleted before any write lands, so the pass is order-independent — no
   * sorting, no overwrite hazards.
   */
  public shiftRows(at: number, delta: number, drop: (cell: Cell) => boolean): { moved: number; dropped: Array<[number, Cell]> } {
    const dropped: Array<[number, Cell]> = [];
    const fromKeys: number[] = [];
    const toKeys: number[] = [];
    const movedCells: Cell[] = [];
    for (const [key, cell] of this.cells) {
      const r = Math.floor(key / TOTAL_COLS);
      if (r < at) continue;
      const nr = r + delta;
      if (drop(cell) || nr < 0 || nr >= TOTAL_ROWS) {
        dropped.push([key, cell]);
        continue;
      }
      fromKeys.push(key);
      toKeys.push(nr * TOTAL_COLS + (key - r * TOTAL_COLS));
      movedCells.push(cell);
    }
    for (const key of fromKeys) this.cells.delete(key);
    for (const [key] of dropped) this.cells.delete(key); // dropped cells leave the map…
    for (let i = 0; i < fromKeys.length; i += 1) this.cells.set(toKeys[i]!, movedCells[i]!);
    if (fromKeys.length > 0 || dropped.length > 0) this.usedBoundsDirty = true;
    return { moved: fromKeys.length, dropped };
  }

  /** Column counterpart of {@link shiftRows}. */
  public shiftCols(at: number, delta: number, drop: (cell: Cell) => boolean): { moved: number; dropped: Array<[number, Cell]> } {
    const dropped: Array<[number, Cell]> = [];
    const fromKeys: number[] = [];
    const toKeys: number[] = [];
    const movedCells: Cell[] = [];
    for (const [key, cell] of this.cells) {
      const r = Math.floor(key / TOTAL_COLS);
      const c = key - r * TOTAL_COLS;
      if (c < at) continue;
      const nc = c + delta;
      if (drop(cell) || nc < 0 || nc >= TOTAL_COLS) {
        dropped.push([key, cell]);
        continue;
      }
      fromKeys.push(key);
      toKeys.push(r * TOTAL_COLS + nc);
      movedCells.push(cell);
    }
    for (const key of fromKeys) this.cells.delete(key);
    for (const [key] of dropped) this.cells.delete(key); // dropped cells leave the map…
    for (let i = 0; i < fromKeys.length; i += 1) this.cells.set(toKeys[i]!, movedCells[i]!);
    if (fromKeys.length > 0 || dropped.length > 0) this.usedBoundsDirty = true;
    return { moved: fromKeys.length, dropped };
  }

  /** The smallest rectangle around every stored cell; undefined when the sheet holds none. */
  public getUsedBounds(): CellRect | undefined {
    if (this.cells.size === 0) return undefined;
    if (this.usedBoundsDirty) this.recomputeUsedBounds();
    return { r1: this.usedMinR, c1: this.usedMinC, r2: this.usedMaxR, c2: this.usedMaxC };
  }

  /** Calls `fn` for every stored cell, or only those inside `rect`. Visit order is unspecified. */
  public forEachCell(fn: (r: number, c: number, cell: Cell) => void, rect?: CellRect): void {
    if (rect === undefined) {
      for (const [key, cell] of this.cells) {
        const r = Math.floor(key / TOTAL_COLS);
        fn(r, key - r * TOTAL_COLS, cell);
      }
      return;
    }
    const r1 = Math.max(0, Math.min(rect.r1, rect.r2));
    const r2 = Math.min(TOTAL_ROWS - 1, Math.max(rect.r1, rect.r2));
    const c1 = Math.max(0, Math.min(rect.c1, rect.c2));
    const c2 = Math.min(TOTAL_COLS - 1, Math.max(rect.c1, rect.c2));
    if (r1 > r2 || c1 > c2) return;
    // Cost must track min(rect area, stored cells): a small rect walks its own
    // addresses (one hash lookup each); a huge rect filters one full sweep.
    // A lookup costs about four times a swept cell (measured: ~1M lookups vs a
    // 1M-cell sweep), so the walk is chosen only while it stays the cheaper one.
    if (4 * (r2 - r1 + 1) * (c2 - c1 + 1) <= this.cells.size) {
      for (let r = r1; r <= r2; r += 1) {
        for (let c = c1; c <= c2; c += 1) {
          const cell = this.getCell(r, c);
          if (cell !== undefined) fn(r, c, cell);
        }
      }
      return;
    }
    for (const [key, cell] of this.cells) {
      const r = Math.floor(key / TOTAL_COLS);
      if (r < r1 || r > r2) continue;
      const c = key - r * TOTAL_COLS;
      if (c < c1 || c > c2) continue;
      fn(r, c, cell);
    }
  }

  private noteCellRemoval(r: number, c: number): void {
    if (this.cells.size === 0) {
      this.usedMinR = -1;
      this.usedMinC = -1;
      this.usedMaxR = -1;
      this.usedMaxC = -1;
      this.usedBoundsDirty = false;
      return;
    }
    // Only a deletion on the current boundary can shrink the bounds; anything
    // else leaves them exact, so getUsedBounds stays O(1).
    if (r === this.usedMinR || r === this.usedMaxR || c === this.usedMinC || c === this.usedMaxC) this.usedBoundsDirty = true;
  }

  private recomputeUsedBounds(): void {
    let minR = Number.POSITIVE_INFINITY;
    let minC = Number.POSITIVE_INFINITY;
    let maxR = -1;
    let maxC = -1;
    for (const key of this.cells.keys()) {
      const r = Math.floor(key / TOTAL_COLS);
      const c = key - r * TOTAL_COLS;
      if (r < minR) minR = r;
      if (c < minC) minC = c;
      if (r > maxR) maxR = r;
      if (c > maxC) maxC = c;
    }
    this.usedMinR = minR;
    this.usedMinC = minC;
    this.usedMaxR = maxR;
    this.usedMaxC = maxC;
    this.usedBoundsDirty = false;
  }

  public getRow(r: number): RowMeta | undefined {
    return this.rows.get(r);
  }

  public setRow(r: number, meta: RowMeta | undefined): void {
    if (meta === undefined) this.rows.delete(r);
    else this.rows.set(r, meta);
  }

  public getCol(c: number): ColMeta | undefined {
    return this.cols.get(c);
  }

  public setCol(c: number, meta: ColMeta | undefined): void {
    if (meta === undefined) this.cols.delete(c);
    else this.cols.set(c, meta);
  }

  public getStyle(id: string): Style | undefined {
    return this.styles.get(id);
  }

  public setStyle(id: string, style: Style | undefined): void {
    if (style === undefined) this.styles.delete(id);
    else this.styles.set(id, style);
  }

  public addMerge(range: string): void {
    if (this.merges.has(range)) return;
    this.merges.add(range);
    const { r1, c1, r2, c2 } = parseRange(range);
    const rect: MergeRect = { r1, c1, r2, c2, range };
    // Row-band index (64 rows per band): a merge costs one entry per band it
    // touches — a whole-column merge stays at TOTAL_ROWS / 64 ≈ 16k entries
    // instead of one per row into the millions. Bands past the grid edge are
    // not indexed, so ranges reaching past the bottom still work.
    const firstBand = Math.max(0, r1) >> MERGE_BAND_SHIFT;
    const lastBand = Math.min(r2, TOTAL_ROWS - 1) >> MERGE_BAND_SHIFT;
    for (let band = firstBand; band <= lastBand; band += 1) {
      const segs = this.mergesByRow.get(band);
      if (segs === undefined) this.mergesByRow.set(band, [rect]);
      else segs.push(rect);
    }
  }

  public removeMerge(range: string): void {
    if (!this.merges.delete(range)) return;
    const { r1, r2 } = parseRange(range);
    const firstBand = Math.max(0, r1) >> MERGE_BAND_SHIFT;
    const lastBand = Math.min(r2, TOTAL_ROWS - 1) >> MERGE_BAND_SHIFT;
    for (let band = firstBand; band <= lastBand; band += 1) {
      const segs = this.mergesByRow.get(band);
      if (segs === undefined) continue;
      const at = segs.findIndex((seg) => seg.range === range);
      if (at >= 0) segs.splice(at, 1);
      if (segs.length === 0) this.mergesByRow.delete(band);
    }
  }

  /** The merge covering (r,c) with parsed bounds, or undefined. No parsing,
   * no allocation: the shared stored rect is returned as-is. */
  public getMergeRectAt(r: number, c: number): MergeRect | undefined {
    const segs = this.mergesByRow.get(r >> MERGE_BAND_SHIFT);
    if (segs === undefined) return undefined;
    for (const seg of segs) {
      // The band holds merges that need not span every row of it, so both
      // coordinates are checked; insertion order keeps "first added wins".
      if (r >= seg.r1 && r <= seg.r2 && c >= seg.c1 && c <= seg.c2) return seg;
    }
    return undefined;
  }

  public getMerges(): readonly string[] {
    return [...this.merges];
  }

  public getRowEntries(): readonly [number, RowMeta][] {
    return [...this.rows.entries()];
  }

  public getColEntries(): readonly [number, ColMeta][] {
    return [...this.cols.entries()];
  }

  /** Public/serialization shape: `[key, Cell]` with "r,c" string keys (built on demand). */
  public getCells(): readonly [string, Cell][] {
    const out: [string, Cell][] = [];
    for (const [key, cell] of this.cells) {
      const r = Math.floor(key / TOTAL_COLS);
      out.push([`${r},${key - r * TOTAL_COLS}`, cell]);
    }
    return out;
  }

  public getConditionalRules(): readonly [string, ConditionalRule[]][] {
    return [...this.conditionalRules.entries()];
  }

  public setConditionalRule(range: string, rules: ConditionalRule[]): void {
    this.conditionalRules.set(range, rules);
  }

  public removeConditionalRule(range: string): void {
    this.conditionalRules.delete(range);
  }

  public getCharts(): readonly ChartSpec[] {
    return [...this.charts.values()];
  }

  public addChart(spec: ChartSpec): void {
    this.charts.set(spec.id, spec);
  }

  public removeChart(id: string): void {
    this.charts.delete(id);
  }

  public getImages(): readonly ImageSpec[] {
    return [...this.images.values()];
  }

  public addImage(spec: ImageSpec): void {
    this.images.set(spec.id, spec);
  }

  public removeImage(id: string): void {
    this.images.delete(id);
  }

  public getRowGroups(): readonly RowGroupDef[] {
    return [...this.rowGroups];
  }

  public setRowGroups(groups: readonly RowGroupDef[]): void {
    this.rowGroups = [...groups];
  }

  public getValidationRules(): readonly [string, ValidationRule][] {
    return [...this.validationRules.entries()];
  }

  public setValidationRule(range: string, rule: ValidationRule): void {
    this.validationRules.set(range, rule);
  }

  public removeValidationRule(range: string): void {
    this.validationRules.delete(range);
  }

  public getValidationRule(r: number, c: number): ValidationRule | undefined {
    for (const [range, rule] of this.validationRules) {
      if (cellInRange(r, c, range)) return rule;
    }
    return undefined;
  }

  public getSparklines(): readonly SparklineSpec[] {
    return [...this.sparklines.values()];
  }

  public addSparkline(spec: SparklineSpec): void {
    this.sparklines.set(spec.id, spec);
  }

  public removeSparkline(id: string): void {
    this.sparklines.delete(id);
  }

  public getSparklineAt(r: number, c: number): SparklineSpec | undefined {
    for (const spec of this.sparklines.values()) {
      if (spec.row === r && spec.col === c) return spec;
    }
    return undefined;
  }

  public getNamedRanges(): readonly [string, NamedRangeDef][] {
    return [...this.namedRanges.entries()];
  }

  public setNamedRange(name: string, def: NamedRangeDef): void {
    this.namedRanges.set(name, def);
  }

  public removeNamedRange(name: string): void {
    this.namedRanges.delete(name);
  }

  public getNamedRange(name: string): NamedRangeDef | undefined {
    return this.namedRanges.get(name);
  }

  public getProtection(): SheetProtectionState | undefined {
    return this.protection;
  }

  public setProtection(state: SheetProtectionState | undefined): void {
    this.protection = state;
  }

  public getAutoFilter(): AutoFilterState | undefined {
    return this.autoFilter;
  }

  public setAutoFilter(state: AutoFilterState | undefined): void {
    this.autoFilter = state;
  }

  public getFreeze(): SheetFreeze | undefined {
    return this.freeze;
  }

  public setFreeze(freeze: SheetFreeze | undefined): void {
    this.freeze = freeze;
  }

  /** Everything serialize() carries except the cells: lets callers (the
   * auto-save encoder) rebuild a sheet's JSON without walking the cells. */
  public serializeFeatures(): Omit<SerializedSheetData, 'cells'> {
    return {
      rows: [...this.rows.entries()],
      cols: [...this.cols.entries()],
      styles: [...this.styles.entries()],
      merges: [...this.merges],
      conditionalRules: [...this.conditionalRules.entries()],
      charts: [...this.charts.values()],
      images: [...this.images.values()],
      rowGroups: [...this.rowGroups],
      validationRules: [...this.validationRules.entries()],
      sparklines: [...this.sparklines.values()],
      namedRanges: [...this.namedRanges.entries()],
      protection: this.protection,
      autoFilter: this.autoFilter,
      freeze: this.freeze,
    };
  }

  public serialize(): SerializedSheetData {
    return {
      cells: this.getCells().map(([key, value]) => {
        if (value.pasteStyle === undefined) return [key, value] as const;
        const { pasteStyle: _p, ...rest } = value;
        return [key, rest] as const;
      }),
      ...this.serializeFeatures(),
    };
  }

  public static deserialize(data: SerializedSheetData): SheetData {
    const sheet = new SheetData();
    data.cells.forEach(([key, value]) => {
      const sep = key.indexOf(',');
      sheet.setCell(Number(key.slice(0, sep)), Number(key.slice(sep + 1)), value);
    });
    data.rows.forEach(([key, value]) => sheet.rows.set(key, value));
    data.cols.forEach(([key, value]) => sheet.cols.set(key, value));
    data.styles.forEach(([key, value]) => sheet.styles.set(key, value));
    data.merges.forEach((merge) => sheet.addMerge(merge));
    data.conditionalRules.forEach(([key, value]) => sheet.conditionalRules.set(key, value));
    data.charts.forEach((spec) => sheet.charts.set(spec.id, spec));
    data.images.forEach((spec) => sheet.images.set(spec.id, spec));
    sheet.rowGroups = [...(data.rowGroups ?? [])];
    data.validationRules.forEach(([key, value]) => sheet.validationRules.set(key, value));
    data.sparklines.forEach((spec) => sheet.sparklines.set(spec.id, spec));
    data.namedRanges.forEach(([key, value]) => sheet.namedRanges.set(key, value));
    if (data.protection !== undefined) sheet.protection = data.protection;
    sheet.autoFilter = data.autoFilter;
    // Optional since it was added late: older saved sheets carry none.
    sheet.freeze = data.freeze;
    return sheet;
  }

  /**
   * A copy of this sheet's whole state without serializing: cells and feature
   * specs are shared by reference (every write constructs a new object — undo
   * snapshots rely on it), containers are fresh so the copies diverge freely.
   */
  public clone(): SheetData {
    const copy = new SheetData();
    for (const [key, cell] of this.cells) copy.cells.set(key, cell);
    for (const [key, meta] of this.rows) copy.rows.set(key, meta);
    for (const [key, meta] of this.cols) copy.cols.set(key, meta);
    for (const [key, style] of this.styles) copy.styles.set(key, style);
    for (const range of this.merges) copy.merges.add(range);
    for (const [band, segs] of this.mergesByRow) copy.mergesByRow.set(band, [...segs]);
    for (const [key, rules] of this.conditionalRules) copy.conditionalRules.set(key, rules);
    for (const [key, spec] of this.charts) copy.charts.set(key, spec);
    for (const [key, spec] of this.images) copy.images.set(key, spec);
    for (const [key, rule] of this.validationRules) copy.validationRules.set(key, rule);
    for (const [key, spec] of this.sparklines) copy.sparklines.set(key, spec);
    for (const [key, def] of this.namedRanges) copy.namedRanges.set(key, def);
    copy.rowGroups = [...this.rowGroups];
    copy.protection = this.protection;
    copy.autoFilter = this.autoFilter;
    copy.freeze = this.freeze;
    copy.usedMinR = this.usedMinR;
    copy.usedMinC = this.usedMinC;
    copy.usedMaxR = this.usedMaxR;
    copy.usedMaxC = this.usedMaxC;
    copy.usedBoundsDirty = this.usedBoundsDirty;
    copy.everHadFormula = this.everHadFormula;
    return copy;
  }
}

function cellInRange(r: number, c: number, range: string): boolean {
  const parsed = parseInternalRange(range);
  return parsed !== null && r >= parsed.r1 && r <= parsed.r2 && c >= parsed.c1 && c <= parsed.c2;
}
