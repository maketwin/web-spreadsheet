export type FormulaValue = string | number | boolean | Date | null;
export type FormulaArgument = FormulaValue | readonly FormulaValue[];

export type AstNode =
  | { type: 'number'; value: number }
  | { type: 'string'; value: string }
  | { type: 'cell'; x: number; y: number; sheetName?: string }
  | { type: 'range'; x1: number; y1: number; x2: number; y2: number; sheetName?: string }
  | { type: 'func'; name: string; args: AstNode[] }
  | { type: 'binary'; op: string; left: AstNode; right: AstNode }
  | { type: 'unary'; op: string; operand: AstNode };

export type CellResolver = (x: number, y: number, sheetName?: string) => FormulaValue;
