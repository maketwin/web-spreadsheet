import { describe, expect, it } from 'vitest';
import {
  applyRunStyle,
  deleteRangeRuns,
  effectiveRunStyle,
  flattenRuns,
  insertAtRuns,
  isRich,
  mergeRuns,
  normalizeRuns,
  replaceInRuns,
  replaceRangeInRuns,
  runStyleAt,
  runsFromText,
  sameRunStyle,
} from '../../src/util/richText';
import { cellFromText } from '../../src/util/cell';
import { Store } from '../../src/store/Store';
import { SetCellText } from '../../src/commands/impl/SetCellText';
import { SetRangeValues } from '../../src/commands/impl/SetRangeValues';

const RED = { color: '#FF0000' };
const BLUE = { color: '#0000FF', bold: true };

/** "abc" with 'a' red, 'bc' blue+bold. */
const AB = [
  { text: 'a', style: RED },
  { text: 'bc', style: BLUE },
] as const;

describe('flattenRuns / isRich / normalizeRuns', () => {
  it('flattens to the exact concatenation', () => {
    expect(flattenRuns(AB)).toBe('abc');
  });

  it('a single unstyled run is not rich', () => {
    expect(isRich([{ text: 'plain' }])).toBe(false);
    expect(isRich([{ text: 'plain', style: {} }])).toBe(false);
    expect(isRich(undefined)).toBe(false);
  });

  it('a single styled run is rich', () => {
    expect(isRich([{ text: 'x', style: RED }])).toBe(true);
  });

  it('normalizeRuns merges adjacent same-style runs and drops empties', () => {
    expect(normalizeRuns([{ text: 'a', style: RED }, { text: '', style: RED }, { text: 'b', style: RED }])).toEqual([{ text: 'ab', style: RED }]);
  });

  it('an unstyled run next to a styled run stays rich (it inherits the cell style)', () => {
    expect(normalizeRuns([{ text: 'a', style: RED }, { text: 'b' }])).toEqual([{ text: 'a', style: RED }, { text: 'b' }]);
  });

  it('normalizeRuns collapses a formatting-free result to undefined', () => {
    expect(normalizeRuns([{ text: 'a' }, { text: 'b' }])).toBeUndefined();
  });

  it('mergeRuns always keeps full text even when plain', () => {
    expect(mergeRuns([{ text: 'a' }, { text: 'b' }])).toEqual([{ text: 'ab' }]);
  });

  it('runsFromText returns undefined for plain text', () => {
    expect(runsFromText('hello')).toBeUndefined();
  });
});

describe('runStyleAt / effectiveRunStyle', () => {
  it('returns the style of the run covering the offset', () => {
    expect(runStyleAt(AB, 0)).toEqual(RED);
    expect(runStyleAt(AB, 1)).toEqual(BLUE);
    expect(runStyleAt(AB, 2)).toEqual(BLUE);
  });

  it('at the very end returns the last run style', () => {
    expect(runStyleAt(AB, 3)).toEqual(BLUE);
  });

  it('effectiveRunStyle merges cell style with run overrides', () => {
    const cellStyle = { fontSize: 14, bold: true, color: '#000000' };
    expect(effectiveRunStyle(cellStyle, { text: 'a' })).toEqual({ bold: true, italic: false, underline: false, strike: false, fontSize: 14, color: '#000000', fontFamily: undefined, vertAlign: undefined });
    expect(effectiveRunStyle(cellStyle, { text: 'a', style: { fontSize: 20 } })!.fontSize).toBe(20);
    // explicit false beats the cell style
    expect(effectiveRunStyle(cellStyle, { text: 'a', style: { bold: false } })!.bold).toBe(false);
  });
});

describe('replaceRangeInRuns', () => {
  it('replaces inside one run and keeps the rest intact', () => {
    const next = replaceRangeInRuns([...AB], 1, 2, 'X');
    expect(flattenRuns(next)).toBe('aXc');
    expect(next).toEqual([{ text: 'a', style: RED }, { text: 'Xc', style: BLUE }]);
  });

  it('spans multiple runs; replacement inherits the first hit style', () => {
    const next = replaceRangeInRuns([...AB], 0, 3, 'Z');
    expect(flattenRuns(next)).toBe('Z');
    expect(next).toEqual([{ text: 'Z', style: RED }]);
  });

  it('deleting every styled part degrades to a plain run', () => {
    const plain = [{ text: 'ab' }];
    const next = replaceRangeInRuns(plain, 0, 1, '');
    expect(flattenRuns(next)).toBe('b');
    expect(isRich(next)).toBe(false);
  });

  it('clamps out-of-range offsets (range [2,99) replaces "c")', () => {
    expect(flattenRuns(replaceRangeInRuns([...AB], 2, 99, '!'))).toBe('ab!');
    expect(flattenRuns(replaceRangeInRuns([...AB], 3, 99, '!'))).toBe('abc!');
  });

  it('empty runs array is handled (insertion into empty cell)', () => {
    expect(flattenRuns(replaceRangeInRuns([], 0, 0, 'hi'))).toBe('hi');
  });
});

describe('replaceInRuns (multi-range)', () => {
  it('applies several ranges with shifting offsets', () => {
    // "aXaX": replace both "a" (each its own style) with "Y" -> "YXYX"
    const runs = [{ text: 'aXaX', style: RED }];
    const next = replaceInRuns(runs, [{ start: 0, end: 1 }, { start: 2, end: 3 }], 'Y');
    expect(flattenRuns(next)).toBe('YXYX');
  });

  it('works across styled runs regardless of range order', () => {
    const next = replaceInRuns([...AB], [{ start: 2, end: 3 }, { start: 0, end: 1 }], 'Z');
    expect(flattenRuns(next)).toBe('ZbZ');
  });
});

describe('insertAtRuns / deleteRangeRuns', () => {
  it('inserted text inherits the style at the insertion point', () => {
    const next = insertAtRuns([...AB], 2, 'Z');
    expect(flattenRuns(next)).toBe('abZc');
    // the inserted Z and its blue neighbours share one style and merge
    expect(next).toEqual([{ text: 'a', style: RED }, { text: 'bZc', style: BLUE }]);
  });

  it('an explicit style wins over the insertion point', () => {
    const next = insertAtRuns([...AB], 0, 'Z', BLUE);
    expect(flattenRuns(next)).toBe('Zabc');
    expect(next).toEqual([{ text: 'Z', style: BLUE }, { text: 'a', style: RED }, { text: 'bc', style: BLUE }]);
  });

  it('delete across a run boundary merges the remains', () => {
    const next = deleteRangeRuns([...AB], 0, 2);
    expect(flattenRuns(next)).toBe('c');
    expect(next).toEqual([{ text: 'c', style: BLUE }]);
  });

  it('deleting everything leaves an empty (plain) array', () => {
    expect(deleteRangeRuns([...AB], 0, 3)).toEqual([]);
  });
});

describe('applyRunStyle', () => {
  it('splits a run at the selection boundaries', () => {
    const runs = [{ text: 'abcd', style: RED }];
    const next = applyRunStyle(runs, 1, 3, { bold: true });
    expect(next).toEqual([
      { text: 'a', style: RED },
      { text: 'bc', style: { color: '#FF0000', bold: true } },
      { text: 'd', style: RED },
    ]);
  });

  it('merges with the existing run style; undefined in the patch clears the override', () => {
    const next = applyRunStyle([{ text: 'a', style: BLUE }], 0, 1, { italic: true, bold: undefined });
    expect(next).toEqual([{ text: 'a', style: { color: '#0000FF', italic: true } }]);
  });

  it('explicit false forces an attribute off; undefined clears the override', () => {
    const runs = [{ text: 'a', style: { bold: true } }];
    expect(applyRunStyle(runs, 0, 1, { bold: false })[0]!.style).toEqual({ bold: false });
    expect(applyRunStyle(runs, 0, 1, { bold: undefined })[0]).toEqual({ text: 'a', style: {} });
  });

  it('styling a plain run range makes it rich', () => {
    const next = applyRunStyle([{ text: 'hello' }], 0, 5, { color: '#00FF00' });
    expect(next).toEqual([{ text: 'hello', style: { color: '#00FF00' } }]);
  });

  it('result collapses back to plain when the only override is removed', () => {
    const next = applyRunStyle([{ text: 'a', style: RED }], 0, 1, { color: undefined });
    expect(isRich(next)).toBe(false);
  });
});

describe('sameRunStyle', () => {
  it('treats undefined and empty object as equal', () => {
    expect(sameRunStyle(undefined, {})).toBe(true);
    expect(sameRunStyle(RED, { color: '#FF0000' })).toBe(true);
    expect(sameRunStyle(RED, BLUE)).toBe(false);
  });
});

describe('cell write paths', () => {
  it('cellFromText drops richText (whole-cell rewrite flattens, like Excel)', () => {
    const rich: Parameters<typeof cellFromText>[0] = { text: 'abc', richText: [...AB] };
    expect(cellFromText(rich, 'xyz').richText).toBeUndefined();
    expect(cellFromText(rich, 'xyz').text).toBe('xyz');
  });

  it('SetCellText carries richText and its undo restores the previous cell', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'abc', richText: [...AB] });
    const cmd = new SetCellText({ r: 0, c: 0, text: 'abc', richText: [...AB] });
    cmd.execute(store);
    expect(store.getCell(0, 0)!.richText).toEqual(AB);

    const undo = cmd.getUndo();
    undo.execute(store);
    expect(store.getCell(0, 0)).toEqual({ text: 'abc', richText: [...AB] });
  });

  it('SetCellText without richText flattens a rich cell', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'abc', richText: [...AB] });
    new SetCellText({ r: 0, c: 0, text: 'typed' }).execute(store);
    const cell = store.getCell(0, 0)!;
    expect(cell.text).toBe('typed');
    expect(cell.richText).toBeUndefined();
  });

  it('SetRangeValues: a plain text patch flattens, an explicit richText patch pastes, a value-only patch preserves', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'abc', richText: [...AB] });

    new SetRangeValues({ r1: 0, c1: 0, r2: 0, c2: 0, values: [[{ text: 'over' }]] }).execute(store);
    expect(store.getCell(0, 0)!.richText).toBeUndefined();

    store.setCell(1, 0, { text: 'abc', richText: [...AB] });
    new SetRangeValues({ r1: 1, c1: 0, r2: 1, c2: 0, values: [[{ text: 'abc', richText: [{ text: 'abc', style: RED }] }]] }).execute(store);
    expect(store.getCell(1, 0)!.richText).toEqual([{ text: 'abc', style: RED }]);

    new SetRangeValues({ r1: 1, c1: 0, r2: 1, c2: 0, values: [[{ value: 'abc' }]] }).execute(store);
    expect(store.getCell(1, 0)!.richText).toEqual([{ text: 'abc', style: RED }]);
  });
});

describe('RichTextRun type sanity', () => {
  it('runs are plain JSON-serializable (IndexedDB autosave)', () => {
    expect(JSON.parse(JSON.stringify({ richText: AB }))).toEqual({ richText: AB });
  });
});
