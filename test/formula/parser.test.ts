import { describe, expect, it } from 'vitest';
import { FormulaParser } from '../../src/formula/parser';

const parser = new FormulaParser();

describe('FormulaParser', () => {
  it('parses a cell reference', () => {
    expect(parser.parse('=A1')).toEqual({ type: 'cell', x: 0, y: 0 });
  });

  it('parses a binary operation', () => {
    expect(parser.parse('=A1+B1')).toEqual({
      type: 'binary',
      op: '+',
      left: { type: 'cell', x: 0, y: 0 },
      right: { type: 'cell', x: 1, y: 0 },
    });
  });

  it('parses a function call', () => {
    expect(parser.parse('=SUM(A1)')).toEqual({
      type: 'func',
      name: 'SUM',
      args: [{ type: 'cell', x: 0, y: 0 }],
    });
  });

  it('parses a function call with range', () => {
    expect(parser.parse('=SUM(A1:A5)')).toEqual({
      type: 'func',
      name: 'SUM',
      args: [{ type: 'range', x1: 0, y1: 0, x2: 0, y2: 4 }],
    });
  });
});
