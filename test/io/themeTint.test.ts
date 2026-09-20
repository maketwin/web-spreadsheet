import { describe, expect, it } from 'vitest';
import { applyThemeTint, parseSharedStrings } from '../../src/io/sharedStrings';

describe('applyThemeTint', () => {
  it('darkens toward black for negative tint', () => {
    expect(applyThemeTint('#4472C4', -0.5)).toBe('#223962');
  });

  it('lightens toward white for positive tint', () => {
    expect(applyThemeTint('#4472C4', 0.5)).toBe('#A2B9E2');
  });

  it('returns base when tint is 0', () => {
    expect(applyThemeTint('#4472C4', 0)).toBe('#4472C4');
  });
});

describe('parseSharedStrings theme + tint', () => {
  it('applies tint on theme color runs', () => {
    const xml = '<si><r><rPr><color theme="4" tint="-0.5"/></rPr><t>x</t></r></si>';
    const entries = parseSharedStrings(xml);
    expect(entries[0]?.runs?.[0]?.style?.color).toBe('#223962');
  });
});
