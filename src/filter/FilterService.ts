import type { Store } from '../store/Store';
import type { AutoFilterCriteria, AutoFilterState, FilterCondition } from '../types';
import { displayTextOf } from '../util/cell';
import { TOTAL_COLS, TOTAL_ROWS } from '../renderer/coordinate';
import { compareExcelValues, sortRowsInPlace } from './sortRows';

const BLANK_LABEL = '(空白)';

export interface FilterItem {
  readonly text: string;
  readonly blank: boolean;
  readonly selected: boolean;
  readonly count: number;
}

/** Service for Excel-like AutoFilter state and range sorting. */
export class FilterService {
  public constructor(private readonly store: Store) {}

  /** Get unique non-empty display values in a column within a range. */
  public getFilterValues(r1: number, c: number, r2: number): string[] {
    const seen = new Set<string>();
    for (let r = r1; r <= r2; r += 1) {
      const text = this.textAt(r, c);
      if (text !== '') seen.add(text);
    }
    return [...seen].sort(compareExcelValues);
  }

  /** Get unique values plus Excel's blank entry, with criteria selection state. */
  public getFilterItems(column: number): FilterItem[] {
    const filter = this.store.getAutoFilter();
    if (filter === undefined) return [];
    const { r1, r2 } = filter.range;
    if (column < filter.range.c1 || column > filter.range.c2) return [];

    // Excel derives the checklist from rows visible under every *other* column
    // filter. The current column is ignored so hidden values can be re-selected.
    const otherCriteria = Object.entries(filter.criteria)
      .filter(([rawColumn]) => Number(rawColumn) !== column)
      .map(([rawColumn, criteria]) => ({ column: Number(rawColumn), criteria }));
    const counts = new Map<string, number>();
    let blankCount = 0;
    for (let r = r1 + 1; r <= r2; r += 1) {
      const matchesOtherFilters = otherCriteria.every(({ column: otherColumn, criteria }) =>
        FilterService.matchesCriteria(this.textAt(r, otherColumn), criteria));
      if (!matchesOtherFilters) continue;
      const text = this.textAt(r, column);
      if (text === '') blankCount += 1;
      else counts.set(text, (counts.get(text) ?? 0) + 1);
    }

    const criteria = filter.criteria[column];
    const items: FilterItem[] = [...counts.entries()]
      .sort(([a], [b]) => compareExcelValues(a, b))
      .map(([text, count]) => ({
        text,
        blank: false,
        count,
        // With custom conditions the checklist mirrors what matches them.
        selected: criteria === undefined ? true : FilterService.matchesCriteria(text, criteria),
      }));
    if (blankCount > 0) {
      items.push({
        text: BLANK_LABEL,
        blank: true,
        count: blankCount,
        selected: criteria === undefined ? true : FilterService.matchesCriteria('', criteria),
      });
    }
    return items;
  }

  /** Turn on AutoFilter for the current region (or exact multi-cell selection). */
  public setAutoFilter(range?: { readonly r1: number; readonly c1: number; readonly r2: number; readonly c2: number }): AutoFilterState {
    const source = range ?? { r1: 0, c1: 0, r2: 0, c2: 0 };
    const state: AutoFilterState = { range: { ...this.inferDataRegion(source) }, criteria: {} };
    this.store.setAutoFilter(state);
    return state;
  }

  /** Remove AutoFilter and unhide all rows in its range. */
  public clearAutoFilter(): AutoFilterState | undefined {
    const old = this.store.getAutoFilter();
    if (old !== undefined) this.unhideRows(old.range.r1 + 1, old.range.r2);
    this.store.setAutoFilter(undefined);
    return old;
  }

  public getAutoFilter(): AutoFilterState | undefined {
    return this.store.getAutoFilter();
  }

  /** Returns true when the point is an active AutoFilter header button. */
  public isFilterHeaderAt(r: number, c: number): boolean {
    const filter = this.store.getAutoFilter();
    return filter !== undefined
      && r === filter.range.r1
      && c >= filter.range.c1
      && c <= filter.range.c2;
  }

  public hasColumnFilter(column: number): boolean {
    return this.store.getAutoFilter()?.criteria[column] !== undefined;
  }

  public setColumnFilter(column: number, criteria: AutoFilterCriteria): void {
    const filter = this.store.getAutoFilter();
    if (filter === undefined || column < filter.range.c1 || column > filter.range.c2) return;
    this.store.setAutoFilter({
      ...filter,
      criteria: { ...filter.criteria, [column]: criteria },
    });
    this.applyFilters();
  }

  public clearColumnFilter(column: number): void {
    const filter = this.store.getAutoFilter();
    if (filter === undefined || filter.criteria[column] === undefined) return;
    const criteria = { ...filter.criteria };
    delete criteria[column];
    this.store.setAutoFilter({ ...filter, criteria });
    this.applyFilters();
  }

  /** Clear every column criterion and show all rows. */
  public clearFilters(): void {
    const filter = this.store.getAutoFilter();
    if (filter === undefined) return;
    this.store.setAutoFilter({ ...filter, criteria: {} });
    this.applyFilters();
  }

  /** Hide rows where any filtered column does not match its checked values. */
  public applyFilters(): void {
    const filter = this.store.getAutoFilter();
    if (filter === undefined) return;
    this.store.batch(() => {
      for (let r = filter.range.r1 + 1; r <= filter.range.r2; r += 1) {
        let visible = true;
        for (const [rawColumn, criteria] of Object.entries(filter.criteria)) {
          if (!FilterService.matchesCriteria(this.textAt(r, Number(rawColumn)), criteria)) { visible = false; break; }
        }
        const meta = this.store.getRow(r);
        this.store.setRow(r, { ...meta, hide: !visible });
      }
    });
  }

  /**
   * Excel visibility rule for one cell under a column criterion. Custom
   * conditions win over the value checklist; blanks only survive a
   * checklist with `includeBlanks`. Like Excel, matching is case-insensitive.
   */
  public static matchesCriteria(text: string, criteria: AutoFilterCriteria): boolean {
    if (criteria.conditions !== undefined && criteria.conditions.length > 0) {
      if (text === '') return false;
      const results = criteria.conditions.map((condition) => matchCondition(text, condition));
      return criteria.conditionsOp === 'or' ? results.some(Boolean) : results.every(Boolean);
    }
    if (text === '') return criteria.includeBlanks;
    const lower = text.toLowerCase();
    return criteria.selected.some((value) => value.toLowerCase() === lower);
  }

  /** Hide rows where column `c` value is not in `allowedValues`. */
  public filterColumn(r1: number, c: number, r2: number, allowedValues: readonly string[]): void {
    const allowed = new Set(allowedValues.map((value) => value.toLowerCase()));
    for (let r = r1; r <= r2; r += 1) {
      const text = this.textAt(r, c);
      const shouldHide = text !== '' && !allowed.has(text.toLowerCase());
      const meta = this.store.getRow(r);
      this.store.setRow(r, { ...meta, hide: shouldHide });
    }
  }

  /** Clear all row hide flags in range. */
  public clearFilter(r1: number, r2: number): void {
    this.unhideRows(r1, r2);
  }

  /** Sort rows in range by column `sortCol` ascending or descending. */
  public sortRange(r1: number, c1: number, r2: number, c2: number, sortCol: number, direction: 'asc' | 'desc'): void {
    let range = { r1, c1, r2, c2, sortCol };
    const filter = this.store.getAutoFilter();
    const isSingleCell = r1 === r2 && c1 === c2;
    if (filter !== undefined && isSingleCell && r1 >= filter.range.r1 && r1 <= filter.range.r2 && c1 >= filter.range.c1 && c1 <= filter.range.c2) {
      range = { ...filter.range, sortCol: c1 };
    } else if (isSingleCell) {
      const inferred = this.inferDataRegion({ r1, c1, r2, c2 });
      range = { ...inferred, sortCol: c1 };
    }
    if (filter !== undefined && range.r1 === filter.range.r1 && range.r2 === filter.range.r2) {
      range.r1 += 1; // Excel keeps the AutoFilter header row in place.
    }
    if (range.r1 > range.r2) return;

    sortRowsInPlace(this.store, range.r1, range.c1, range.r2, range.c2, range.sortCol, direction);
    this.applyFilters();
  }

  /** Excel AutoFilter expands a one-cell anchor to its current data region. */
  public inferAutoFilterRange(anchor: { readonly r1: number; readonly c1: number; readonly r2: number; readonly c2: number }): { readonly r1: number; readonly c1: number; readonly r2: number; readonly c2: number } {
    return this.inferDataRegion(anchor);
  }

  /**
   * Excel's AutoFilter range for a selection:
   * - a partial multi-cell selection filters exactly that range;
   * - an entire-column selection filters only the selected columns, with
   *   rows taken from those columns' own data block (arrows appear on the
   *   selected columns, not the whole region);
   * - a single cell, an entire row, or no selection filters the current
   *   region of the anchor.
   */
  public autoFilterRangeFor(selection: { readonly r1: number; readonly c1: number; readonly r2: number; readonly c2: number } | null): { readonly r1: number; readonly c1: number; readonly r2: number; readonly c2: number } {
    if (selection === null) return this.inferDataRegion({ r1: 0, c1: 0, r2: 0, c2: 0 });
    const isFullSheet = selection.r1 === 0 && selection.c1 === 0 && selection.r2 === TOTAL_ROWS - 1 && selection.c2 === TOTAL_COLS - 1;
    const isEntireColumn = selection.r1 === 0 && selection.r2 === TOTAL_ROWS - 1 && !isFullSheet;
    if (isEntireColumn) {
      const firstRow = this.firstDataRowInColumns(selection.c1, selection.c2);
      const region = this.inferDataRegion({ r1: firstRow, c1: selection.c1, r2: firstRow, c2: selection.c2 });
      return { r1: region.r1, c1: selection.c1, r2: region.r2, c2: selection.c2 };
    }
    const isSingleCell = selection.r1 === selection.r2 && selection.c1 === selection.c2;
    const isEntireRow = selection.c1 === 0 && selection.c2 === TOTAL_COLS - 1;
    if (isSingleCell || isEntireRow) return this.inferDataRegion(selection);
    return { r1: selection.r1, c1: selection.c1, r2: selection.r2, c2: selection.c2 };
  }

  /**
   * Excel CurrentRegion: grow the rectangle from the anchor in all four
   * directions until a completely blank row/column (or the sheet edge)
   * borders it. Iterate to a fixed point because widening the rectangle can
   * let it grow further along the other axis.
   */
  public inferDataRegion(anchor: { readonly r1: number; readonly c1: number; readonly r2: number; readonly c2: number }): { readonly r1: number; readonly c1: number; readonly r2: number; readonly c2: number } {
    let { r1, c1, r2, c2 } = anchor;
    for (let round = 0; round < 8; round += 1) {
      let changed = false;
      while (r1 > 0 && this.rowHasData(r1 - 1, c1, c2)) { r1 -= 1; changed = true; }
      while (r2 + 1 < TOTAL_ROWS && this.rowHasData(r2 + 1, c1, c2)) { r2 += 1; changed = true; }
      while (c1 > 0 && this.columnHasData(c1 - 1, r1, r2)) { c1 -= 1; changed = true; }
      while (c2 + 1 < TOTAL_COLS && this.columnHasData(c2 + 1, r1, r2)) { c2 += 1; changed = true; }
      if (!changed) break;
    }
    return { r1, c1, r2, c2 };
  }

  /** The value this cell displays: number-formatted text when styled, raw text otherwise. */
  private textAt(r: number, c: number): string {
    const cell = this.store.getCell(r, c);
    if (cell === undefined) return '';
    return displayTextOf(cell, cell.styleId === undefined ? undefined : this.store.getStyle(cell.styleId));
  }

  private rowHasData(row: number, from: number, to: number): boolean {
    for (let c = from; c <= to; c += 1) if (this.hasData(row, c)) return true;
    return false;
  }

  private columnHasData(column: number, from: number, to: number): boolean {
    for (let r = from; r <= to; r += 1) if (this.hasData(r, column)) return true;
    return false;
  }

  private hasData(r: number, c: number): boolean {
    const cell = this.store.getCell(r, c);
    return cell !== undefined && (cell.text !== '' || cell.formula !== undefined);
  }

  /** First row with any data between columns c1..c2; 0 when the columns are empty. */
  private firstDataRowInColumns(c1: number, c2: number): number {
    for (let r = 0; r < TOTAL_ROWS; r += 1) {
      for (let c = c1; c <= c2; c += 1) {
        if (this.hasData(r, c)) return r;
      }
    }
    return 0;
  }

  private unhideRows(from: number, to: number): void {
    for (let r = from; r <= to; r += 1) {
      const meta = this.store.getRow(r);
      if (meta?.hide === true) this.store.setRow(r, { ...meta, hide: false });
    }
  }
}

const NUMERIC_OPERATORS = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between']);

/** Match one Excel custom-filter condition; numeric ops compare as numbers when both sides parse. */
function matchCondition(text: string, condition: FilterCondition): boolean {
  const { operator, value } = condition;
  if (!NUMERIC_OPERATORS.has(operator)) {
    const haystack = text.toLowerCase();
    const needle = value.toLowerCase();
    switch (operator) {
      case 'contains': return haystack.includes(needle);
      case 'notContains': return !haystack.includes(needle);
      case 'beginsWith': return haystack.startsWith(needle);
      case 'endsWith': return haystack.endsWith(needle);
      default: return true;
    }
  }
  const textNumber = Number(text);
  const valueNumber = Number(value);
  const bothNumeric = value !== '' && Number.isFinite(textNumber) && Number.isFinite(valueNumber);
  const compare = (other: string): number => {
    const otherNumber = Number(other);
    if (bothNumeric && Number.isFinite(otherNumber)) return textNumber - otherNumber;
    return text.toLowerCase().localeCompare(other.toLowerCase());
  };
  switch (operator) {
    case 'eq': return compare(value) === 0;
    case 'neq': return compare(value) !== 0;
    case 'gt': return compare(value) > 0;
    case 'gte': return compare(value) >= 0;
    case 'lt': return compare(value) < 0;
    case 'lte': return compare(value) <= 0;
    case 'between': return compare(value) >= 0 && compare(condition.value2 ?? '') <= 0;
    default: return true;
  }
}
