import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { parseFormulaRefs, REF_HIGHLIGHT_PALETTE, useFormulaAssist } from '../../src/components/formulaAssist';

function setup() {
  return renderHook(() => useFormulaAssist());
}

const change = (hook: ReturnType<typeof setup>, value: string): void => {
  act(() => { hook.result.current.afterChange(value, value.length); });
};

describe('useFormulaAssist — suggestions', () => {
  it('non-formula input clears suggestions and signature', () => {
    const hook = setup();
    change(hook, '=SU');
    change(hook, 'plain text');
    expect(hook.result.current.suggestions).toBeNull();
    expect(hook.result.current.signature).toBeNull();
  });

  it('a trailing identifier after = offers completion items anchored at the token', () => {
    const hook = setup();
    change(hook, '=SU');
    const s = hook.result.current.suggestions;
    expect(s).not.toBeNull();
    expect(s!.items).toContain('SUM');
    expect(s!.from).toBe(1);
    expect(s!.to).toBe(3);
    expect(s!.active).toBe(0);
  });

  it('a suggestion also triggers after ( , operators', () => {
    const hook = setup();
    change(hook, '=SUM(A1,LE');
    const s = hook.result.current.suggestions;
    expect(s).not.toBeNull();
    expect(s!.items[0]).toBe('LEFT');
    expect(s!.from).toBe(8);
  });

  it('a token preceded by a non-boundary character (cell ref digits) offers nothing', () => {
    const hook = setup();
    change(hook, '=A1B2');
    expect(hook.result.current.suggestions).toBeNull();
  });

  it('a closed call offers no suggestions', () => {
    const hook = setup();
    change(hook, '=SUM(A1)');
    expect(hook.result.current.suggestions).toBeNull();
  });

  it('an unknown function name offers no suggestions', () => {
    const hook = setup();
    change(hook, '=ZZZQ');
    expect(hook.result.current.suggestions).toBeNull();
  });
});

describe('useFormulaAssist — signature tooltip', () => {
  it('shows the innermost unclosed catalog function with argIndex 0', () => {
    const hook = setup();
    change(hook, '=SUM(');
    const sig = hook.result.current.signature;
    expect(sig).not.toBeNull();
    expect(sig!.name).toBe('SUM');
    expect(sig!.argIndex).toBe(0);
    expect(sig!.sig.length).toBeGreaterThan(0);
  });

  it('counts commas at the function depth for argIndex', () => {
    const hook = setup();
    change(hook, '=SUM(A1,B2');
    expect(hook.result.current.signature!.argIndex).toBe(1);
  });

  it('nested calls track the innermost function', () => {
    const hook = setup();
    change(hook, '=IF(SUM(');
    expect(hook.result.current.signature!.name).toBe('SUM');
    change(hook, '=IF(SUM(A1),C');
    // The trailing token also keeps the suggestion list alive for C* names.
    expect(hook.result.current.suggestions).not.toBeNull();
  });

  it('a closing paren drops the signature', () => {
    const hook = setup();
    change(hook, '=SUM(A1)');
    expect(hook.result.current.signature).toBeNull();
  });

  it('commas inside string literals do not advance argIndex', () => {
    const hook = setup();
    change(hook, '=SUBSTITUTE("a,b",');
    expect(hook.result.current.signature!.name).toBe('SUBSTITUTE');
    expect(hook.result.current.signature!.argIndex).toBe(1);
  });

  it('adjacent literals keep their separating commas (the real stripLiterals regression)', () => {
    // The old quote-stuffing mask made the paren scanner swallow the comma
    // BETWEEN two literals — argIndex came out one too low.
    const hook = setup();
    change(hook, '=SUBSTITUTE("a","b",');
    expect(hook.result.current.signature!.name).toBe('SUBSTITUTE');
    expect(hook.result.current.signature!.argIndex).toBe(2);
  });

  it('escaped quotes inside literals still mask cleanly', () => {
    const hook = setup();
    change(hook, '=SUBSTITUTE("a""b",1,');
    expect(hook.result.current.signature!.name).toBe('SUBSTITUTE');
    expect(hook.result.current.signature!.argIndex).toBe(2);
  });

  it('an unclosed non-catalog call shows no signature', () => {
    const hook = setup();
    change(hook, '=NOSUCHFN(');
    expect(hook.result.current.signature).toBeNull();
  });
});

describe('useFormulaAssist — keyboard', () => {
  it('Tab completes the active item and opens its signature', () => {
    const hook = setup();
    change(hook, '=SU');
    const first = hook.result.current.suggestions!.items[0]!;
    const applied: Array<{ value: string; caret: number }> = [];
    let consumed: boolean | undefined;
    act(() => {
      consumed = hook.result.current.onKeyDown('Tab', '=SU', 3, (value, caret) => { applied.push({ value, caret }); });
    });
    expect(consumed).toBe(true);
    expect(applied).toEqual([{ value: `=${first}(`, caret: 1 + first.length + 1 }]);
    expect(hook.result.current.suggestions).toBeNull();
    expect(hook.result.current.signature!.name).toBe(first);
  });

  it('Enter completes exactly like Tab', () => {
    const hook = setup();
    change(hook, '=SU');
    const first = hook.result.current.suggestions!.items[0]!;
    let next = '';
    act(() => { hook.result.current.onKeyDown('Enter', '=SU', 3, (value) => { next = value; }); });
    expect(next).toBe(`=${first}(`);
  });

  it('ArrowDown/ArrowUp cycle the active item with wraparound', () => {
    const hook = setup();
    change(hook, '=S'); // SUM, SUBTOTAL, … more than one match
    const count = hook.result.current.suggestions!.items.length;
    expect(count).toBeGreaterThan(1);
    act(() => { hook.result.current.onKeyDown('ArrowDown', '=S', 2, () => {}); });
    expect(hook.result.current.suggestions!.active).toBe(1);
    act(() => { hook.result.current.onKeyDown('ArrowUp', '=S', 2, () => {}); });
    expect(hook.result.current.suggestions!.active).toBe(0);
    act(() => { hook.result.current.onKeyDown('ArrowUp', '=S', 2, () => {}); });
    expect(hook.result.current.suggestions!.active).toBe(count - 1);
  });

  it('Escape dismisses and consumes the key', () => {
    const hook = setup();
    change(hook, '=SU');
    let consumed = false;
    act(() => { consumed = hook.result.current.onKeyDown('Escape', '=SU', 3, () => {}); });
    expect(consumed).toBe(true);
    expect(hook.result.current.suggestions).toBeNull();
  });

  it('unrelated keys fall through (not consumed) while the list is open', () => {
    const hook = setup();
    change(hook, '=SU');
    let consumed = true;
    act(() => { consumed = hook.result.current.onKeyDown('ArrowLeft', '=SU', 3, () => {}); });
    expect(consumed).toBe(false);
  });

  it('no suggestions → every key falls through', () => {
    const hook = setup();
    let consumed = true;
    act(() => { consumed = hook.result.current.onKeyDown('Tab', 'x', 1, () => {}); });
    expect(consumed).toBe(false);
  });

  it('dismiss clears the list without consuming anything', () => {
    const hook = setup();
    change(hook, '=SU');
    act(() => { hook.result.current.dismiss(); });
    expect(hook.result.current.suggestions).toBeNull();
  });

  it('completion preserves text after the caret', () => {
    const hook = setup();
    change(hook, '=SUM(A1,LE'); // suggestion anchors at token [8,10)
    const applied: Array<{ value: string; caret: number }> = [];
    act(() => { hook.result.current.onKeyDown('Tab', '=SUM(A1,LEX)+1', 10, (value, caret) => { applied.push({ value, caret }); }); });
    // 'LE' at [8,10) is replaced by 'LEFT(' and the trailing X)+1 survives.
    expect(applied[0]?.value).toBe('=SUM(A1,LEFT(X)+1');
    expect(applied[0]?.caret).toBe('=SUM(A1,LEFT('.length);
  });
});

describe('parseFormulaRefs', () => {
  it('parses a single cell reference', () => {
    expect(parseFormulaRefs('=A1')).toEqual([{ x1: 0, y1: 0, x2: 0, y2: 0 }]);
  });

  it('parses a range and normalizes reversed corners', () => {
    expect(parseFormulaRefs('=SUM(C3:B2)')).toEqual([{ x1: 1, y1: 1, x2: 2, y2: 2 }]);
  });

  it('handles $ anchors and multi-letter columns', () => {
    expect(parseFormulaRefs('=$AA$10')).toEqual([{ x1: 26, y1: 9, x2: 26, y2: 9 }]);
  });

  it('skips function names that look like refs', () => {
    expect(parseFormulaRefs('=LOG10(5)')).toEqual([]);
  });

  it('skips refs inside string literals', () => {
    expect(parseFormulaRefs('="A1"&B2')).toEqual([{ x1: 1, y1: 1, x2: 1, y2: 1 }]);
  });

  it('skips a ref followed by an identifier character', () => {
    expect(parseFormulaRefs('=A1B')).toEqual([]);
  });

  it('collects multiple refs', () => {
    const refs = parseFormulaRefs('=A1+D4:E6');
    expect(refs.length).toBe(2);
    expect(refs[1]).toEqual({ x1: 3, y1: 3, x2: 4, y2: 5 });
  });

  it('exposes the highlight palette', () => {
    expect(REF_HIGHLIGHT_PALETTE.length).toBeGreaterThan(0);
  });
});
