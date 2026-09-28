export type FormulaValue = string | number | boolean | Date | null;
/**
 * A dynamic-array result (SEQUENCE/FILTER/…). Row-major `data` with an
 * explicit shape; only a TOP-LEVEL matrix result spills into neighbouring
 * cells — inside expressions a matrix flattens to its row-major array.
 */
export interface MatrixValue { readonly __matrix: true; readonly rows: number; readonly cols: number; readonly data: readonly FormulaValue[] }
export type FormulaArgument = FormulaValue | readonly FormulaValue[] | MatrixValue;
export const matrix = (rows: number, cols: number, data: readonly FormulaValue[]): MatrixValue => ({ __matrix: true, rows, cols, data });
export const isMatrix = (value: FormulaArgument | undefined): value is MatrixValue =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && (value as MatrixValue).__matrix === true;

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
