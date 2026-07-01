import { describe, expect, expectTypeOf, it } from 'vitest';
import type { AstNode, CellResolver, FormulaValue } from '../../src/formula/types';

describe('formula types', () => {
  it('imports formula types', () => {
    expectTypeOf<FormulaValue>().toEqualTypeOf<string | number | boolean | Date | null>();
    expectTypeOf<CellResolver>().returns.toEqualTypeOf<FormulaValue>();
  });

  it('can use formula types as explicit annotations', () => {
    const value: FormulaValue = 42;
    const node: AstNode = { type: 'number', value };

    expect(node).toEqual({ type: 'number', value: 42 });
  });
});
