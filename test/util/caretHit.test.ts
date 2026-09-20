import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { caretOffsetFromLocalPoint } from '../../src/util/caretHit';

describe('caretOffsetFromLocalPoint', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      font: '',
      measureText: (s: string) => ({ width: s.length * 10 }),
    } as unknown as CanvasRenderingContext2D);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('places caret on the second hard-break line by Y', () => {
    const text = 'line1\nline2';
    const offset = caretOffsetFromLocalPoint({
      text,
      localX: 15,
      localY: 40,
      cellW: 120,
      cellH: 60,
      style: { valign: 'top', fontSize: 11 },
      zoom: 100,
    });
    expect(offset).toBeGreaterThanOrEqual(6);
    expect(text.slice(0, offset).includes('\n')).toBe(true);
  });

  it('uses soft-wrap lines when wrap is on', () => {
    const text = 'abcdefghij';
    // 40px cell, ~10px/char → ~3 chars/line → y=30 hits a later soft line
    const offset = caretOffsetFromLocalPoint({
      text,
      localX: 5,
      localY: 30,
      cellW: 40,
      cellH: 80,
      style: { wrap: true, valign: 'top', fontSize: 11 },
      zoom: 100,
    });
    expect(offset).toBeGreaterThan(0);
    expect(offset).toBeLessThan(text.length);
  });

  it('returns 0 for empty text', () => {
    expect(caretOffsetFromLocalPoint({
      text: '',
      localX: 10,
      localY: 10,
      cellW: 50,
      cellH: 20,
    })).toBe(0);
  });

  it('mixed run font sizes shift X hit vs uniform size', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      font: '11px sans-serif',
      measureText(this: { font: string }, s: string) {
        const m = /(\d+(?:\.\d+)?)px/.exec(this.font);
        const px = m !== null ? Number(m[1]) : 11;
        return { width: s.length * px };
      },
    } as unknown as CanvasRenderingContext2D);

    const text = 'AAAAABBBBB';
    const runs = [
      { text: 'AAAAA', style: { fontSize: 10 } },
      { text: 'BBBBB', style: { fontSize: 30 } },
    ];
    // X just past the 5 small glyphs (5*10) into the first large glyph.
    const x = 3 + 5 * 10 + 5;
    const mixed = caretOffsetFromLocalPoint({
      text,
      localX: x,
      localY: 10,
      cellW: 400,
      cellH: 40,
      style: { valign: 'top', fontSize: 10, align: 'left' },
      zoom: 100,
      runs,
    });
    const uniform = caretOffsetFromLocalPoint({
      text,
      localX: x,
      localY: 10,
      cellW: 400,
      cellH: 40,
      style: { valign: 'top', fontSize: 10, align: 'left' },
      zoom: 100,
    });
    // Mixed: still near the run boundary (large glyphs eat X faster).
    expect(mixed).toBeGreaterThanOrEqual(5);
    expect(mixed).toBeLessThan(uniform);
    expect(uniform).toBeGreaterThan(5);
  });

  it('returns 0 when click is left of content', () => {
    expect(caretOffsetFromLocalPoint({
      text: 'Hi',
      localX: 0,
      localY: 10,
      cellW: 100,
      cellH: 20,
      style: { valign: 'top', align: 'left', fontSize: 11 },
    })).toBe(0);
  });
});
