import { registry } from './registry';
import type { AstNode, CellResolver, FormulaValue } from './types';

export function evaluate(node: AstNode, resolve: CellResolver): FormulaValue {
  switch (node.type) {
    case 'number':
      return node.value;
    case 'string':
      return node.value;
    case 'cell':
      return resolve(node.x, node.y);
    case 'range':
      return null;
    case 'func':
      return evaluateFunction(node, resolve);
    case 'binary':
      return evaluateBinary(node, resolve);
    case 'unary':
      return evaluateUnary(node, resolve);
  }
}

function evaluateFunction(node: Extract<AstNode, { type: 'func' }>, resolve: CellResolver): FormulaValue {
  const spec = registry.get(node.name);
  if (!spec) return null;
  const args = node.args.map((arg): FormulaValue => (arg.type === 'range' ? null : evaluate(arg, resolve)));
  return spec.evaluate(args);
}

function evaluateBinary(node: Extract<AstNode, { type: 'binary' }>, resolve: CellResolver): FormulaValue {
  const left = evaluate(node.left, resolve);
  const right = evaluate(node.right, resolve);

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
  const value = evaluate(node.operand, resolve);
  return node.op === '-' ? -Number(value) : Number(value);
}
