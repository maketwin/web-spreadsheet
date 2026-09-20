import type { Style } from '../types';

export type CellValueOperator =
  | 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq' | 'between' | 'contains';

export type ConditionalRule =
  | { type: 'dataBar'; min: number; max: number; color: string }
  | { type: 'colorScale'; min: number; max: number; minColor: string; maxColor: string }
  | { type: 'formula'; formula: string; style: Partial<Style> }
  | {
    type: 'cellValue';
    operator: CellValueOperator;
    value: string | number;
    value2?: string | number;
    style: Partial<Style>;
  };

/** Overlay computed by the conditional service for a single cell. */
export interface ConditionalOverlay {
  readonly style?: Partial<Style> | undefined;
  readonly dataBar?: { ratio: number; color: string } | undefined;
}
