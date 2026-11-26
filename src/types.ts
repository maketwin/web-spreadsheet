export type CellValue = string | number | boolean | Date | null;

/**
 * Character-level attributes Excel lets you apply to part of a cell's text
 * (the OOXML `<rPr>` scope — no character-level fill exists in xlsx). Every
 * field overrides the same field of the cell's whole-cell Style; absent
 * fields inherit it.
 */
export interface RunStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  fontSize?: number;
  fontFamily?: string;
  color?: string;
  vertAlign?: 'subscript' | 'superscript';
}

/** One formatted slice of a rich-text cell. */
export interface RichTextRun {
  text: string;
  style?: RunStyle;
}

/** Cell hyperlink (Excel-style). */
export interface CellHyperlink {
  /** URL, mailto:, or A1 / Sheet!A1 worksheet reference. */
  readonly target: string;
  readonly tooltip?: string;
}

/** Cell comment/note (Excel-style): red-triangle indicator, text shown on demand. */
export interface CellComment {
  readonly text: string;
  readonly author?: string;
  /** ISO timestamp of when the comment was created. */
  readonly createdAt?: string;
}

export interface Cell {
  text: string;
  value?: CellValue;
  formula?: string;
  styleId?: string;
  type?: 'text' | 'number' | 'date' | 'boolean';
  /**
   * Rich text runs for a text-constant cell. When present, `text` is exactly
   * the concatenation of the run texts (kept in sync by the write paths in
   * util/cell.ts and util/richText.ts). Plain cells leave this undefined —
   * a single unstyled run is never stored.
   */
  richText?: RichTextRun[];
  /** Ephemeral HTML-paste cell style; converted to styleId on apply, not serialized. */
  pasteStyle?: Partial<Style>;
  /**
   * Dynamic-array spill shadow: set on cells written by an anchor formula's
   * overflow (value = "sheetId:r,c" of the anchor). Serialized with the cell;
   * cleared and rewritten wholesale on every anchor recalculation.
   */
  spillOf?: string;
  /** Optional hyperlink; absent means no link. */
  hyperlink?: CellHyperlink;
  /** Optional comment/note; drawn with a red-triangle indicator. */
  comment?: CellComment;
}

export interface RowMeta {
  height?: number;
  hide?: boolean;
  /** Axis default style (whole-row format). Cells without their own styleId show it. */
  styleId?: string | undefined;
}

export interface ColMeta {
  width?: number;
  hide?: boolean;
  /** Axis default style (whole-column format). Cells without their own styleId show it. */
  styleId?: string | undefined;
}

export interface Style {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  /** Excel strikethrough (cell-level). */
  strike?: boolean;
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
  /** Excel indent levels (0..15); shifts left-aligned text. */
  indent?: number;
  /** Excel text rotation in degrees (−90..90; 255 = stacked, treated as 0 for now). */
  textRotation?: number;
  border?: { top?: string; bottom?: string; left?: string; right?: string };
}

export type StoreEvent =
  | { type: 'cell'; r: number; c: number; cell: Cell | undefined; sheetId?: string }
  | { type: 'row'; r: number; meta: RowMeta | undefined; sheetId?: string }
  | { type: 'col'; c: number; meta: ColMeta | undefined; sheetId?: string }
  /**
   * Rows/columns were inserted or deleted wholesale: the half-plane at/after
   * `start` moved in one piece. Delivered once per structural command instead
   * of one event per moved cell — subscribers rebuild position-dependent
   * state from this (the store already holds the final state when it
   * arrives). Cell content moved with it emits no per-cell events.
   */
  | { type: 'structure'; axis: 'row' | 'col'; kind: 'insert' | 'delete'; start: number; count: number; sheetId?: string }
  /**
   * A batch of cells was rewritten in one piece (undo putting deleted cells
   * back, and the like); `keys` are `r * TOTAL_COLS + c` into the named
   * sheet. One event instead of one per cell.
   */
  | { type: 'cells'; keys: readonly number[]; sheetId?: string }
  /** A real cell-style change only (`setStyle`); feature changes have their own types below. */
  | { type: 'style'; id: string; style: Style | undefined; sheetId?: string }
  | { type: 'merge'; range: string; sheetId?: string }
  | { type: 'sheet'; action: 'activate' | 'add' | 'rename' | 'move' | 'recolor' | 'delete'; sheetId: string; name?: string }
  | { type: 'autofilter'; sheetId: string }
  /** The whole workbook was swapped (open / new / restore): cached registrations are void. */
  | { type: 'workbook'; action: 'replace' }
  /** Conditional formatting rules of one range changed (`setConditionalRule` / `removeConditionalRule`). */
  | { type: 'conditionalRules'; range: string; sheetId?: string }
  /** A floating chart was added or removed; `id` is the chart spec id. */
  | { type: 'charts'; id: string; sheetId?: string }
  /** A floating image was added or removed; `id` is the image spec id. */
  | { type: 'images'; id: string; sheetId?: string }
  /** A sparkline was added or removed; `id` is the sparkline spec id. */
  | { type: 'sparklines'; id: string; sheetId?: string }
  /** The data-validation rule of one range changed (`setValidationRule` / `removeValidationRule`). */
  | { type: 'validations'; range: string; sheetId?: string }
  /** A named range was defined or removed; `name` is the defined name. */
  | { type: 'namedRanges'; name: string; sheetId?: string }
  /** The sheet's row grouping outline changed (no per-change identity: always delivered in order). */
  | { type: 'rowGroups'; sheetId?: string }
  /** The sheet's frozen rows/cols changed (no per-change identity: always delivered in order). */
  | { type: 'freeze'; sheetId?: string }
  /** The sheet's protection state changed (no per-change identity: always delivered in order). */
  | { type: 'protection'; sheetId?: string }
  /** The workbook-level password changed; workbook-wide, so no sheetId. */
  | { type: 'workbookPassword' };

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
