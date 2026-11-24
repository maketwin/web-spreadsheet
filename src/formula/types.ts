export type FormulaValue = string | number | boolean | Date | null;
/**
 * A dynamic-array result (SEQUENCE/FILTER/…, or arithmetic on a range or
 * array). Row-major `data` with an explicit shape; only a TOP-LEVEL matrix
 * result spills into neighbouring cells. Inside an expression an operator
 * maps over it and keeps the shape; most functions take it as its row-major
 * array (UNIQUE / SORT / FILTER keep the shape too).
 */
export interface MatrixValue { readonly __matrix: true; readonly rows: number; readonly cols: number; readonly data: readonly FormulaValue[] }
export type FormulaArgument = FormulaValue | readonly FormulaValue[] | MatrixValue;
export const matrix = (rows: number, cols: number, data: readonly FormulaValue[]): MatrixValue => ({ __matrix: true, rows, cols, data });
export const isMatrix = (value: FormulaArgument | undefined): value is MatrixValue =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && (value as MatrixValue).__matrix === true;

/**
 * The Excel error values — the only place they are listed. The classic seven,
 * the dynamic-array errors (Excel 365) and `#API!` (the Mock platform's
 * failed fetch, `API_ERROR` in src/platform/MockHub.ts). Plain text that
 * merely starts with `#` (`#tag`) is not in here and never counts as an error.
 */
export const EXCEL_ERRORS: ReadonlySet<string> = new Set([
  '#NULL!', '#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#NUM!', '#N/A', '#SPILL!', '#CALC!', '#API!',
]);

/** A value that is itself an Excel error literal ('#DIV/0!', '#N/A', …). */
export const isExcelError = (v: FormulaValue | undefined): v is string =>
  typeof v === 'string' && EXCEL_ERRORS.has(v);

export type AstNode =
  | { type: 'number'; value: number }
  | { type: 'string'; value: string }
  | { type: 'cell'; x: number; y: number; sheetName?: string }
  | { type: 'range'; x1: number; y1: number; x2: number; y2: number; sheetName?: string }
  | { type: 'func'; name: string; args: AstNode[] }
  | { type: 'binary'; op: string; left: AstNode; right: AstNode }
  | { type: 'unary'; op: string; operand: AstNode }
  | { type: 'name'; value: string };

export type CellResolver = (x: number, y: number, sheetName?: string) => FormulaValue;
