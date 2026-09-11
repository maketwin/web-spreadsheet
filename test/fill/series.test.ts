import { describe, expect, it } from 'vitest';
import { nextSeriesValues } from '../../src/fill/series';

describe('nextSeriesValues', () => {
  describe('numeric', () => {
    it('single plain number is NOT a series by default (Excel copies)', () => {
      expect(nextSeriesValues(['5'], 3)).toBeUndefined();
    });
    it('single number steps by 1 with singleNumberStep (Excel Ctrl-drag)', () => {
      expect(nextSeriesValues(['5'], 3, { singleNumberStep: true })).toEqual(['6', '7', '8']);
    });
    it('single number steps by -1 upward with singleNumberStep', () => {
      expect(nextSeriesValues(['5'], 2, { singleNumberStep: true, direction: -1 })).toEqual(['4', '3']);
    });
    it('two values continue the arithmetic step', () => {
      expect(nextSeriesValues(['1', '3'], 3)).toEqual(['5', '7', '9']);
    });
    it('negative step', () => {
      expect(nextSeriesValues(['10', '8'], 2)).toEqual(['6', '4']);
    });
    it('decimals without float artifacts', () => {
      expect(nextSeriesValues(['0.1', '0.2'], 2)).toEqual(['0.3', '0.4']);
    });
    it('non-arithmetic source follows its least-squares trend (Excel TREND)', () => {
      // 1,2,4 fits y = 1.5x + 5/6 → 5.3333…, 6.8333…, 8.3333…
      expect(nextSeriesValues(['1', '2', '4'], 3)).toEqual(['5.3333333333', '6.8333333333', '8.3333333333']);
    });
    it('continues before the first value with direction -1', () => {
      expect(nextSeriesValues(['1', '3'], 2, { direction: -1 })).toEqual(['-1', '-3']);
      expect(nextSeriesValues(['2', '4', '6'], 2, { direction: -1 })).toEqual(['0', '-2']);
    });
    it('non-numeric returns undefined', () => {
      expect(nextSeriesValues(['abc'], 2)).toBeUndefined();
    });
  });

  describe('dates', () => {
    it('single date steps by one day', () => {
      expect(nextSeriesValues(['2026-09-10'], 3)).toEqual(['2026-09-11', '2026-09-12', '2026-09-13']);
    });
    it('single date steps back one day with direction -1', () => {
      expect(nextSeriesValues(['2026-09-10'], 2, { direction: -1 })).toEqual(['2026-09-09', '2026-09-08']);
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
    it('keeps slash separator and padding of the source', () => {
      expect(nextSeriesValues(['2026/01/30'], 2)).toEqual(['2026/01/31', '2026/02/01']);
      expect(nextSeriesValues(['2026.1.5'], 1)).toEqual(['2026.1.6']);
    });
    it('invalid dates fall through to text+number continuation', () => {
      expect(nextSeriesValues(['2026-13-01'], 1)).toEqual(['2026-13-02']);
    });
    it('mixed date and non-date is not a series', () => {
      expect(nextSeriesValues(['2026-09-10', 'hello'], 1)).toBeUndefined();
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
    it('infers a step inside a list (Mon,Wed → Fri)', () => {
      expect(nextSeriesValues(['Mon', 'Wed'], 2)).toEqual(['Fri', 'Sun']);
    });
    it('continues backwards with direction -1 (Mon → Sun)', () => {
      expect(nextSeriesValues(['Mon'], 2, { direction: -1 })).toEqual(['Sun', 'Sat']);
    });
    it('chinese list step also works backwards', () => {
      expect(nextSeriesValues(['一月'], 1, { direction: -1 })).toEqual(['十二月']);
    });
    it('mixed non-list cells are not a series', () => {
      expect(nextSeriesValues(['5', 'Mon'], 2)).toBeUndefined();
    });
  });

  describe('text + number', () => {
    it('increments the trailing number', () => {
      expect(nextSeriesValues(['Item1'], 3)).toEqual(['Item2', 'Item3', 'Item4']);
    });
    it('decrements upward with direction -1', () => {
      expect(nextSeriesValues(['Item1'], 2, { direction: -1 })).toEqual(['Item0', 'Item-1']);
    });
    it('infers step from two values', () => {
      expect(nextSeriesValues(['Q1', 'Q3'], 2)).toEqual(['Q5', 'Q7']);
    });
    it('keeps zero padding', () => {
      expect(nextSeriesValues(['A01'], 2)).toEqual(['A02', 'A03']);
    });
    it('drops padding when the number outgrows it', () => {
      expect(nextSeriesValues(['A09'], 1)).toEqual(['A10']);
    });
    it('plain text returns undefined', () => {
      expect(nextSeriesValues(['hello'], 2)).toBeUndefined();
    });
  });

  it('empty source returns undefined', () => {
    expect(nextSeriesValues([], 3)).toBeUndefined();
  });
});
