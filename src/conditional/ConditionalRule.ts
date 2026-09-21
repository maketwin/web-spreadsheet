import type { Style } from '../types';

export type CellValueOperator =
  | 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq' | 'between' | 'contains';

export type IconSetName = 'arrows3' | 'lights3';

export type ConditionalRule = (
  | { type: 'dataBar'; min: number; max: number; color: string }
  | { type: 'colorScale'; min: number; max: number; minColor: string; maxColor: string }
  | { type: 'formula'; formula: string; style: Partial<Style> }
  | {
    type: 'cellValue';
    operator: CellValueOperator;
    value: string | number;
    value2?: string | number;
    style: Partial<Style>;
  }
  | {
    type: 'iconSet';
    icons: IconSetName;
    /**
     * Thresholds [high, low] (default [67, 33]). With `basis: 'percent'`
     * they are 0-100 percents of the range min..max span (Excel default);
     * with `basis: 'num'` they are literal numbers.
     */
    thresholds?: readonly [number, number];
    basis?: 'percent' | 'num';
  }
) & {
  /** Managed rules can be switched off without deletion (Excel 管理规则 stop-if style toggle). */
  readonly disabled?: boolean;
};

/** Overlay computed by the conditional service for a single cell. */
export interface ConditionalOverlay {
  readonly style?: Partial<Style> | undefined;
  readonly dataBar?: { ratio: number; color: string } | undefined;
  /** Icon-set hit: level 0 = top icon (highest values), 2 = bottom icon. */
  readonly icon?: { icons: IconSetName; level: 0 | 1 | 2 } | undefined;
}
