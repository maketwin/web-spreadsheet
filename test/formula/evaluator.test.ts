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

describe('Excel error propagation', () => {
  const cellValue = (v: unknown): CellResolver => () => v as never;
  const add = (resolve: CellResolver): unknown =>
    evaluate({ type: 'binary', op: '+', left: { type: 'cell', x: 0, y: 0 }, right: { type: 'number', value: 1 } }, resolve);

  it('propagates real Excel error literals through arithmetic', () => {
    for (const err of ['#NULL!', '#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#NUM!', '#N/A']) {
      expect(add(cellValue(err))).toBe(err);
    }
  });

  it('does not treat plain #-prefixed text as an error', () => {
    expect(add(cellValue('#tag'))).toBe('#VALUE!');
    expect(add(cellValue('#'))).toBe('#VALUE!');
  });

  it('returns #DIV/0! when dividing by zero', () => {
    expect(evaluate({ type: 'binary', op: '/', left: { type: 'number', value: 1 }, right: { type: 'number', value: 0 } }, emptyResolver)).toBe('#DIV/0!');
  });

  it('maps NaN to #VALUE! and Infinity to #NUM!', () => {
    expect(add(cellValue('abc'))).toBe('#VALUE!');
    expect(evaluate({ type: 'binary', op: '*', left: { type: 'number', value: 1e308 }, right: { type: 'number', value: 1e308 } }, emptyResolver)).toBe('#NUM!');
  });
});
