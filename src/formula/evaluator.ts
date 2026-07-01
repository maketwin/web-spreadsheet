import { registry } from './registry';
import type { AstNode, CellResolver, FormulaArgument, FormulaValue } from './types';

export function evaluate(node: AstNode, resolve: CellResolver): FormulaArgument {
  switch (node.type) {
    case 'number':
      return node.value;
    case 'string':
      return node.value;
    case 'cell':
      return resolve(node.x, node.y, node.sheetName);
    case 'range':
      return evaluateRange(node, resolve);
    case 'func':
      return evaluateFunction(node, resolve);
    case 'binary':
      return evaluateBinary(node, resolve);
    case 'unary':
      return evaluateUnary(node, resolve);
  }
}

function evaluateRange(node: Extract<AstNode, { type: 'range' }>, resolve: CellResolver): readonly FormulaValue[] {
  const values: FormulaValue[] = [];
  const x1 = Math.min(node.x1, node.x2);
  const x2 = Math.max(node.x1, node.x2);
  const y1 = Math.min(node.y1, node.y2);
  const y2 = Math.max(node.y1, node.y2);

  for (let y = y1; y <= y2; y += 1) {
    for (let x = x1; x <= x2; x += 1) values.push(resolve(x, y, node.sheetName));
  }
  return values;
}

function evaluateFunction(node: Extract<AstNode, { type: 'func' }>, resolve: CellResolver): FormulaArgument {
  const spec = registry.get(node.name);
  if (!spec) return null;
  return spec.evaluate(node.args.map((arg) => evaluate(arg, resolve)));
}

function evaluateBinary(node: Extract<AstNode, { type: 'binary' }>, resolve: CellResolver): FormulaValue {
  const left = scalar(evaluate(node.left, resolve));
  const right = scalar(evaluate(node.right, resolve));

  switch (node.op) {
    case '+':
      return Number(left) + Number(right);
    case '-':
      return Number(left) - Number(right);
    case '*':
      return Number(left) * Number(right);
    case '/':
      return Number(left) / Number(right);
    default:
      return null;
  }
}

function evaluateUnary(node: Extract<AstNode, { type: 'unary' }>, resolve: CellResolver): FormulaValue {
  const value = scalar(evaluate(node.operand, resolve));
  return node.op === '-' ? -Number(value) : Number(value);
}

function scalar(value: FormulaArgument): FormulaValue {
  if (isFormulaList(value)) return value[0] ?? null;
  return value;
}

function isFormulaList(value: FormulaArgument): value is readonly FormulaValue[] {
  return Array.isArray(value);
}
