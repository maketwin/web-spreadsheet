import { describe, expect, it } from 'vitest';
import { drawRichLines, layoutRichText, richContentHeight } from '../../src/renderer/richTextLayout';
import type { LayoutRichTextOptions } from '../../src/renderer/richTextLayout';

/** Deterministic measure: every char is 10px per unit font size. */
const measure = (font: string, text: string): number => {
  const size = Number(font.match(/(\d+)px/)?.[1] ?? 11);
  return text.length * size * 10;
};

function layout(overrides: Partial<LayoutRichTextOptions>): ReturnType<typeof layoutRichText> {
  return layoutRichText({
    runs: [{ text: 'hello' }],
    cellStyle: undefined,
    fontFamilyFallback: 'Calibri',
    colorFallback: '#000000',
    measure,
    maxWidth: 1000,
    wrap: false,
    ...overrides,
  });
}

describe('layoutRichText', () => {
  it('produces one line with one segment for plain runs', () => {
    const lines = layout({});
    expect(lines).toHaveLength(1);
    expect(lines[0]!.segments).toEqual([expect.objectContaining({ text: 'hello', color: '#000000' })]);
    expect(lines[0]!.maxFontSize).toBe(11);
    expect(lines[0]!.lineHeight).toBeCloseTo(11 * 1.25);
  });

  it('splits styled runs into segments preserving order', () => {
    const lines = layout({ runs: [{ text: 'ab', style: { color: '#FF0000', fontSize: 20 } }, { text: 'cd' }] });
    expect(lines).toHaveLength(1);
    expect(lines[0]!.segments.map((s) => s.text)).toEqual(['ab', 'cd']);
    expect(lines[0]!.segments[0]!.color).toBe('#FF0000');
    expect(lines[0]!.segments[1]!.color).toBe('#000000');
    expect(lines[0]!.maxFontSize).toBe(20);
  });

  it('hard breaks split lines even without wrap', () => {
    const lines = layout({ runs: [{ text: 'a\nb' }] });
    expect(lines.map((l) => l.segments.map((s) => s.text).join(''))).toEqual(['a', 'b']);
  });

  it('soft wrap breaks a long run at the width limit', () => {
    // 11px font → each char 110px wide; maxWidth 500 fits 4 chars per line.
    const lines = layout({ runs: [{ text: 'abcdefgh' }], wrap: true, maxWidth: 500 });
    expect(lines.map((l) => l.segments.map((s) => s.text).join(''))).toEqual(['abcd', 'efgh']);
  });

  it('wrap breaks can split inside a run and continue into the next', () => {
    const lines = layout({ runs: [{ text: 'aaaa', style: { color: '#FF0000' } }, { text: 'bbbb' }], wrap: true, maxWidth: 500 });
    expect(lines).toHaveLength(2);
    // first line: 4 red chars fill it; second: remaining blue chars
    expect(lines[0]!.segments).toHaveLength(1);
    expect(lines[0]!.segments[0]!.color).toBe('#FF0000');
    expect(lines[1]!.segments[0]!.color).toBe('#000000');
  });

  it('coalesces adjacent same-style chars back into one segment across a break-free line', () => {
    const lines = layout({ runs: [{ text: 'a', style: { color: '#FF0000' } }, { text: 'b', style: { color: '#FF0000' } }] });
    expect(lines[0]!.segments).toHaveLength(1);
    expect(lines[0]!.segments[0]!.text).toBe('ab');
  });

  it('script runs scale down and shift the baseline', () => {
    const lines = layout({ runs: [{ text: 'x2', style: { vertAlign: 'subscript' } }] });
    const seg = lines[0]!.segments[0]!;
    expect(seg.drawSize).toBe(Math.round(11 * 0.62));
    expect(seg.baselineShift).toBeGreaterThan(0);
    // line height follows the pre-script size
    expect(lines[0]!.maxFontSize).toBe(11);
  });

  it('zoom scales font sizes and measurement', () => {
    const lines = layout({ fontSizeScale: 2, fontSizeFloor: 8 });
    expect(lines[0]!.maxFontSize).toBe(22);
    expect(lines[0]!.width).toBe(5 * 22 * 10);
  });

  it('inherits cell style when the run has no override', () => {
    const lines = layout({ cellStyle: { color: '#123456', bold: true, fontSize: 14 }, runs: [{ text: 'z' }] });
    const seg = lines[0]!.segments[0]!;
    expect(seg.color).toBe('#123456');
    expect(seg.font).toContain('bold');
    expect(seg.font).toContain('14px');
  });

  it('empty runs produce no lines', () => {
    expect(layout({ runs: [] })).toEqual([]);
    expect(layout({ runs: [{ text: '' }] })).toEqual([]);
  });

  it('richContentHeight sums line heights', () => {
    const lines = layout({ runs: [{ text: 'a\nb\nc' }] });
    expect(richContentHeight(lines)).toBeCloseTo(3 * 11 * 1.25);
  });
});

describe('drawRichLines', () => {
  it('positions segments left-to-right and aligns right by the line width', () => {
    const calls: Array<{ text: string; x: number; font: string }> = [];
    const ctx = {
      set textAlign(v: string) { void v; },
      set textBaseline(v: string) { void v; },
      set font(v: string) { (ctx as { currentFont?: string }).currentFont = v; },
      set fillStyle(v: string) { void v; },
      set strokeStyle(v: string) { void v; },
      set lineWidth(v: number) { void v; },
      beginPath(): void {},
      moveTo(): void {},
      lineTo(): void {},
      stroke(): void {},
      fillText(text: string, x: number): void {
        calls.push({ text, x, font: (ctx as { currentFont?: string }).currentFont ?? '' });
      },
    } as unknown as CanvasRenderingContext2D;

    const lines = layout({ runs: [{ text: 'ab', style: { color: '#FF0000' } }, { text: 'c' }], wrap: true, maxWidth: 500 });
    // 11px font → 110px/char; maxWidth 500 → line break after 4 chars? "abc" is 330px so one line of ab|c? No: a(110)+b(110)=220, +c(110)=330 ≤ 500 → single line "abc"? runs differ in style → two segments.
    drawRichLines(ctx, lines, 100, 600, 10, 'right');
    expect(calls).toHaveLength(2);
    // right-aligned: start = 100 + 600 - 3 - width(330) = 367
    expect(calls[0]!.x).toBeCloseTo(367);
    expect(calls[1]!.x).toBeCloseTo(367 + 220);
  });
});
