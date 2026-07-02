/** Supported chart types. */
export type ChartType = 'bar' | 'line' | 'pie';

/** Specification for a chart embedded in the sheet. */
export interface ChartSpec {
  readonly id: string;
  readonly type: ChartType;
  readonly range: string;
  readonly title?: string | undefined;
  readonly sheetId?: string | undefined;
}
