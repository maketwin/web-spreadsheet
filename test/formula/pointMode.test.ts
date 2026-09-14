import { describe, expect, it } from 'vitest';
import { cycleDollars, endsWithRef, isPointTrigger, refAtCaret, upsertRef } from '../../src/formula/pointMode';

describe('point mode (Excel formula reference insertion)', () => {
  it('triggers on formulas awaiting an operand', () => {
    expect(isPointTrigger('=')).toBe(true);
    expect(isPointTrigger('=A1+')).toBe(true);
    expect(isPointTrigger('=SUM(')).toBe(true);
    expect(isPointTrigger('=SUM(A1,')).toBe(true);
    expect(isPointTrigger('=A1')).toBe(false);
    expect(isPointTrigger('abc+')).toBe(false);
  });

  it('upserts references', () => {
    expect(upsertRef('=', 'A1', false)).toBe('=A1');
    expect(upsertRef('=A1+', 'B2', false)).toBe('=A1+B2');
    expect(upsertRef('=A1', 'C3', true)).toBe('=C3');
    expect(upsertRef('=Sheet1!A1+', 'B2', false)).toBe('=Sheet1!A1+B2');
    expect(endsWithRef('=A1')).toBe(true);
    expect(endsWithRef('=A1+')).toBe(false);
  });

  it('finds the reference at the caret for F4', () => {
    expect(refAtCaret('=A1+B2', 2)).toMatchObject({ start: 1, end: 3, text: 'A1' });
    expect(refAtCaret('=A1+B2', 3)).toMatchObject({ text: 'A1' });
    expect(refAtCaret('=A1+B2', 6)).toMatchObject({ text: 'B2' });
    expect(refAtCaret('=SUM(1,2)', 3)).toBeUndefined();
  });

  it('cycles dollar anchors like Excel F4', () => {
    expect(cycleDollars('A1')).toBe('$A$1');
    expect(cycleDollars('$A$1')).toBe('A$1');
    expect(cycleDollars('A$1')).toBe('$A1');
    expect(cycleDollars('$A1')).toBe('A1');
  });
});
