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
});
