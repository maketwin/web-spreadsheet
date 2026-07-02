import type { Cell, ColMeta, RowMeta, Style } from '../types';
import type { ConditionalRule } from '../conditional/ConditionalRule';
import type { ChartSpec } from '../charts/types';
import type { ValidationRule } from '../validation/types';

export interface SerializedSheetData {
  readonly cells: Array<[string, Cell]>;
  readonly rows: Array<[number, RowMeta]>;
  readonly cols: Array<[number, ColMeta]>;
  readonly styles: Array<[string, Style]>;
  readonly merges: string[];
  readonly conditionalRules: Array<[string, ConditionalRule[]]>;
  readonly charts: ChartSpec[];
  readonly validationRules: Array<[string, ValidationRule]>;
}

export class SheetData {
  private readonly cells = new Map<string, Cell>();
  private readonly rows = new Map<number, RowMeta>();
  private readonly cols = new Map<number, ColMeta>();
  private readonly styles = new Map<string, Style>();
  private readonly merges = new Set<string>();
  private readonly conditionalRules = new Map<string, ConditionalRule[]>();
  private readonly charts = new Map<string, ChartSpec>();
  private readonly validationRules = new Map<string, ValidationRule>();

  public getCell(r: number, c: number): Cell | undefined {
    return this.cells.get(keyOf(r, c));
  }

  public setCell(r: number, c: number, cell: Cell | undefined): void {
    const key = keyOf(r, c);
    if (cell === undefined) this.cells.delete(key);
    else this.cells.set(key, cell);
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
    this.merges.add(range);
  }

  public removeMerge(range: string): void {
    this.merges.delete(range);
  }

  public getMerges(): readonly string[] {
    return [...this.merges];
  }

  public getCells(): readonly [string, Cell][] {
    return [...this.cells.entries()];
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

  public serialize(): SerializedSheetData {
    return {
      cells: [...this.cells.entries()],
      rows: [...this.rows.entries()],
      cols: [...this.cols.entries()],
      styles: [...this.styles.entries()],
      merges: [...this.merges],
      conditionalRules: [...this.conditionalRules.entries()],
      charts: [...this.charts.values()],
      validationRules: [...this.validationRules.entries()],
    };
  }

  public static deserialize(data: SerializedSheetData): SheetData {
    const sheet = new SheetData();
    data.cells.forEach(([key, value]) => sheet.cells.set(key, value));
    data.rows.forEach(([key, value]) => sheet.rows.set(key, value));
    data.cols.forEach(([key, value]) => sheet.cols.set(key, value));
    data.styles.forEach(([key, value]) => sheet.styles.set(key, value));
    data.merges.forEach((merge) => sheet.merges.add(merge));
    data.conditionalRules.forEach(([key, value]) => sheet.conditionalRules.set(key, value));
    data.charts.forEach((spec) => sheet.charts.set(spec.id, spec));
    data.validationRules.forEach(([key, value]) => sheet.validationRules.set(key, value));
    return sheet;
  }
}

function keyOf(r: number, c: number): string {
  return `${r},${c}`;
}

function cellInRange(r: number, c: number, range: string): boolean {
  const parts = range.split(':');
  const start = parts[0]?.split(',').map(Number) ?? [0, 0];
  const end = parts[1]?.split(',').map(Number) ?? start;
  return r >= (start[0] ?? 0) && r <= (end[0] ?? 0) && c >= (start[1] ?? 0) && c <= (end[1] ?? 0);
}
