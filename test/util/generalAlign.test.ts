import { describe, expect, it } from 'vitest';
import { resolveCellAlign } from '../../src/util/generalAlign';
import { DEFAULT_FONT_SIZE } from '../../src/util/defaults';

describe('resolveCellAlign (Excel General)', () => {
  it('keeps explicit alignment', () => {
    expect(resolveCellAlign('center', 42)).toBe('center');
    expect(resolveCellAlign('left', 42)).toBe('left');
  });

  it('rights numbers and centers booleans when unset', () => {
    expect(resolveCellAlign(undefined, 3.14)).toBe('right');
    expect(resolveCellAlign(undefined, true)).toBe('center');
  });

  it('lefts text and formula view', () => {
    expect(resolveCellAlign(undefined, 'hello')).toBe('left');
    expect(resolveCellAlign(undefined, 10, { showFormula: true, formula: '=A1' })).toBe('left');
  });
});

describe('DEFAULT_FONT_SIZE', () => {
  it('is Excel Calibri 11', () => {
    expect(DEFAULT_FONT_SIZE).toBe(11);
  });
});
