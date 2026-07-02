/** Supported sparkline types. */
export type SparklineType = 'line' | 'bar' | 'winloss';

/** Sparkline spec stored in the sheet. */
export interface SparklineSpec {
  readonly id: string;
  readonly type: SparklineType;
  readonly range: string;
  readonly row: number;
  readonly col: number;
}
