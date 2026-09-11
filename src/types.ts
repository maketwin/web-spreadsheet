export type CellValue = string | number | boolean | Date | null;

export interface Cell {
  text: string;
  value?: CellValue;
  formula?: string;
  styleId?: string;
  type?: 'text' | 'number' | 'date' | 'boolean';
}

export interface RowMeta {
  height?: number;
  hide?: boolean;
}

export interface ColMeta {
  width?: number;
  hide?: boolean;
}

export interface Style {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  bgcolor?: string;
  align?: 'left' | 'center' | 'right';
  valign?: 'top' | 'middle' | 'bottom';
  fontSize?: number;
  fontFamily?: string;
  /**
   * Built-in names ('general' | 'number' | 'currency' | 'percent' | 'date' |
   * 'time' | 'scientific') or an Excel-style custom format string such as
   * '#,##0.00' or 'yyyy-mm-dd'.
   */
  numberFormat?: string;
  wrap?: boolean;
  border?: { top?: string; bottom?: string; left?: string; right?: string };
}

export type StoreEvent =
  | { type: 'cell'; r: number; c: number; cell: Cell | undefined; sheetId?: string }
  | { type: 'row'; r: number; meta: RowMeta | undefined; sheetId?: string }
  | { type: 'col'; c: number; meta: ColMeta | undefined; sheetId?: string }
  | { type: 'style'; id: string; style: Style | undefined; sheetId?: string }
  | { type: 'merge'; range: string; sheetId?: string }
  | { type: 'sheet'; action: 'activate' | 'add' | 'rename' | 'delete'; sheetId: string; name?: string }
  | { type: 'autofilter'; sheetId: string };

export type Unsubscribe = () => void;

export type FilterConditionOperator =
  | 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'between'
  | 'contains' | 'notContains' | 'beginsWith' | 'endsWith';

/** One Excel custom-filter condition; `value2` is only used by `between`. */
export interface FilterCondition {
  readonly operator: FilterConditionOperator;
  readonly value: string;
  readonly value2?: string;
}

export interface AutoFilterCriteria {
  readonly selected: readonly string[];
  readonly includeBlanks: boolean;
  /**
   * Excel custom-filter conditions (1 or 2). When present they take
   * precedence over the value checklist, mirroring Excel where applying a
   * custom filter replaces the checklist selection.
   */
  readonly conditions?: readonly FilterCondition[];
  /** How two conditions combine; defaults to 'and'. */
  readonly conditionsOp?: 'and' | 'or';
}

export interface AutoFilterState {
  readonly range: { readonly r1: number; readonly c1: number; readonly r2: number; readonly c2: number };
  readonly criteria: Readonly<Record<number, AutoFilterCriteria>>;
}
