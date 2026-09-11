import { describe, expect, it } from 'vitest';
import { nextSeriesValues } from '../../src/fill/series';

describe('nextSeriesValues (T2.3)', () => {
  describe('numeric', () => {
    it('single value steps by 1', () => {
      expect(nextSeriesValues(['5'], 3)).toEqual(['6', '7', '8']);
    });
    it('two values infer the step', () => {
      expect(nextSeriesValues(['1', '3'], 3)).toEqual(['5', '7', '9']);
    });
    it('negative step', () => {
      expect(nextSeriesValues(['10', '8'], 2)).toEqual(['6', '4']);
    });
    it('decimals without float artifacts', () => {
      expect(nextSeriesValues(['0.1', '0.2'], 2)).toEqual(['0.3', '0.4']);
    });
    it('non-numeric returns undefined', () => {
      expect(nextSeriesValues(['abc'], 2)).toBeUndefined();
    });
  });

  describe('dates', () => {
    it('single date steps by one day', () => {
      expect(nextSeriesValues(['2026-09-10'], 3)).toEqual(['2026-09-11', '2026-09-12', '2026-09-13']);
    });
    it('crosses month boundary', () => {
      expect(nextSeriesValues(['2026-01-31'], 2)).toEqual(['2026-02-01', '2026-02-02']);
    });
    it('crosses year boundary', () => {
      expect(nextSeriesValues(['2025-12-31'], 1)).toEqual(['2026-01-01']);
    });
    it('infers weekly step from two dates', () => {
      expect(nextSeriesValues(['2026-09-01', '2026-09-08'], 1)).toEqual(['2026-09-15']);
    });
    it('invalid dates fall through to text+number continuation', () => {
      expect(nextSeriesValues(['2026-13-01'], 1)).toEqual(['2026-13-02']);
    });
  });

  describe('text lists', () => {
    it('weekday short en', () => {
      expect(nextSeriesValues(['Fri'], 3)).toEqual(['Sat', 'Sun', 'Mon']);
    });
    it('weekday long en case-insensitive', () => {
      expect(nextSeriesValues(['saturday'], 2)).toEqual(['Sunday', 'Monday']);
    });
    it('month short en wraps the year', () => {
      expect(nextSeriesValues(['Nov'], 2)).toEqual(['Dec', 'Jan']);
    });
    it('month long en', () => {
      expect(nextSeriesValues(['December'], 1)).toEqual(['January']);
    });
    it('chinese weekdays', () => {
      expect(nextSeriesValues(['星期六'], 2)).toEqual(['星期日', '星期一']);
    });
    it('chinese months', () => {
      expect(nextSeriesValues(['十一月'], 2)).toEqual(['十二月', '一月']);
    });
  });

  describe('text + number', () => {
    it('increments the trailing number', () => {
      expect(nextSeriesValues(['Item1'], 3)).toEqual(['Item2', 'Item3', 'Item4']);
    });
    it('infers step from two values', () => {
      expect(nextSeriesValues(['Q1', 'Q3'], 2)).toEqual(['Q5', 'Q7']);
    });
    it('keeps zero padding', () => {
      expect(nextSeriesValues(['A01'], 2)).toEqual(['A02', 'A03']);
    });
    it('plain text returns undefined', () => {
      expect(nextSeriesValues(['hello'], 2)).toBeUndefined();
    });
  });

  it('empty source returns undefined', () => {
    expect(nextSeriesValues([], 3)).toBeUndefined();
  });
});
