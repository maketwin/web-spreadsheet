import { describe, expect, it } from 'vitest';
import { evaluate } from '../../src/formula/evaluator';
import type { AstNode, CellResolver } from '../../src/formula/types';

const emptyResolver: CellResolver = () => null;

describe('evaluate', () => {
  it('evaluates a number node', () => {
    expect(evaluate({ type: 'number', value: 42 }, emptyResolver)).toBe(42);
  });

  it('evaluates a cell reference', () => {
    const resolver: CellResolver = (x, y) => (x === 0 && y === 0 ? 10 : null);

    expect(evaluate({ type: 'cell', x: 0, y: 0 }, resolver)).toBe(10);
  });

  it('evaluates a binary operation', () => {
    const node: AstNode = {
      type: 'binary',
      op: '+',
      left: { type: 'number', value: 2 },
      right: { type: 'number', value: 3 },
    };

    expect(evaluate(node, emptyResolver)).toBe(5);
  });

  it('evaluates a function call', () => {
    const node: AstNode = {
      type: 'func',
      name: 'SUM',
      args: [
        { type: 'number', value: 2 },
        { type: 'number', value: 3 },
      ],
    };

    expect(evaluate(node, emptyResolver)).toBe(5);
  });
});
