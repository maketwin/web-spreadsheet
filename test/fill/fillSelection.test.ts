import { describe, expect, it } from 'vitest';
import { fillSelectionPatches } from '../../src/fill/fillSelection';

describe('fillSelectionPatches (Excel Ctrl+Enter)', () => {
  const range = { r1: 1, c1: 1, r2: 3, c2: 2 };
  const anchor = { r: 1, c: 1 };

  it('fills plain text into every cell', () => {
    const patches = fillSelectionPatches(range, anchor, 'hello');
    expect(patches).toHaveLength(3);
    for (const row of patches) for (const p of row) {
      expect(p.text).toBe('hello');
      expect(p.formula).toBeUndefined();
      expect(p.richText).toBeUndefined();
    }
  });

  it('copies richText runs onto every filled cell', () => {
    const runs = [
      { text: 'Hi', style: { bold: true } },
      { text: ' there', style: { color: '#FF0000' } },
    ];
    const patches = fillSelectionPatches(range, anchor, 'Hi there', runs);
    for (const row of patches) for (const p of row) {
      expect(p.text).toBe('Hi there');
      expect(p.richText).toEqual([
        { text: 'Hi', style: { bold: true } },
        { text: ' there', style: { color: '#FF0000' } },
      ]);
    }
  });

  it('does not attach runs to formula fills', () => {
    const runs = [{ text: '=A1', style: { bold: true } }];
    const patches = fillSelectionPatches(range, anchor, '=A1', runs);
    expect(patches[0]?.[0]?.formula).toBe('=A1');
    expect(patches[0]?.[0]?.richText).toBeUndefined();
    expect(patches[1]?.[0]?.formula).toBe('=A2');
  });

  it('parses numbers into values', () => {
    const patches = fillSelectionPatches({ r1: 0, c1: 0, r2: 0, c2: 0 }, { r: 0, c: 0 }, '42');
    expect(patches[0]?.[0]?.value).toBe(42);
  });

  it('shifts relative formula refs per cell offset from the anchor', () => {
    const patches = fillSelectionPatches(range, anchor, '=A1+B2');
    expect(patches[0]?.[0]?.formula).toBe('=A1+B2'); // anchor: verbatim
    expect(patches[1]?.[0]?.formula).toBe('=A2+B3'); // one row down
    expect(patches[0]?.[1]?.formula).toBe('=B1+C2'); // one col right
    expect(patches[2]?.[1]?.formula).toBe('=B3+C4');
  });

  it('keeps absolute refs fixed while shifting relative ones', () => {
    const patches = fillSelectionPatches(range, anchor, '=$A$1+A1');
    expect(patches[1]?.[1]?.formula).toBe('=$A$1+B2');
  });

  it('anchor need not be the range corner', () => {
    const patches = fillSelectionPatches(range, { r: 2, c: 2 }, '=C5');
    expect(patches[0]?.[0]?.formula).toBe('=B4'); // one up, one left of the anchor
    expect(patches[1]?.[1]?.formula).toBe('=C5');
  });
});
