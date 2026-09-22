import { describe, expect, it } from 'vitest';
import { FormulaEngine } from '../../src/formula/FormulaEngine';
import { Store } from '../../src/store/Store';

/** Tier-1 hot formula gap fill: SUMPRODUCT, FIND/SEARCH, SUBSTITUTE/REPLACE,
 * DATE/TIME/DATEDIF, LARGE/SMALL, RANK.EQ, ROW/COLUMN/ROWS/COLUMNS, MEDIAN,
 * STDEV family, MAXIFS/MINIFS. */
describe('hot formulas (tier 1)', () => {
  const run = (formula: string): unknown => {
    const store = new Store();
    const engine = new FormulaEngine(store);
    store.setCell(4, 4, { text: formula });
    engine.setFormula('4,4', formula, []);
    return store.getCell(4, 4)?.value;
  };

  const runWith = (values: Record<string, unknown>, formula: string): unknown => {
    const store = new Store();
    const engine = new FormulaEngine(store);
    for (const [id, v] of Object.entries(values)) {
      const [r, c] = id.split(',').map(Number);
      store.setCell(r!, c!, { text: String(v), value: v as number });
    }
    store.setCell(9, 9, { text: formula });
    engine.setFormula('9,9', formula, []);
    return store.getCell(9, 9)?.value;
  };

  it('SUMPRODUCT multiplies element-wise and sums (booleans from comparisons count as 1/0)', () => {
    expect(runWith({ '0,0': 2, '1,0': 3, '0,1': 10, '1,1': 20 }, '=SUMPRODUCT(A1:A2,B1:B2)')).toBe(2 * 10 + 3 * 20);
    expect(run('=SUMPRODUCT((9>5)*(2),(3))')).toBe(6);
    expect(run('=SUMPRODUCT(A1:A2,B1:B2)')).toBe(0); // empty single cells: 0-length → 0? (both 1-length blanks multiply to 0)
  });

  it('FIND is case-sensitive, SEARCH is case-insensitive with wildcards', () => {
    expect(run('=FIND("c","abcabc")')).toBe(3);
    expect(run('=FIND("C","abcabc")')).toBe('#VALUE!');
    expect(run('=FIND("b","abcabc",4)')).toBe(5);
    expect(run('=SEARCH("C","abcabc")')).toBe(3);
    expect(run('=SEARCH("b*c","xxb123c")')).toBe(3);
    expect(run('=SEARCH("a?c","xxabc")')).toBe(3);
    expect(run('=SEARCH("q","abc")')).toBe('#VALUE!');
  });

  it('SUBSTITUTE replaces all or one instance; REPLACE splices by position', () => {
    expect(run('=SUBSTITUTE("a-b-a","a","z")')).toBe('z-b-z');
    expect(run('=SUBSTITUTE("a-b-a","a","z",2)')).toBe('a-b-z');
    expect(run('=SUBSTITUTE("abc","","z")')).toBe('abc');
    expect(run('=REPLACE("abcdef",2,3,"X")')).toBe('aXef');
    expect(run('=EXACT("a","a")')).toBe(true);
    expect(run('=EXACT("a","A")')).toBe(false);
  });

  it('DATE / TIME construct normalized values', () => {
    expect(run('=DATE(2026,9,22)')).toBe('2026-09-22');
    // month overflow rolls over (Excel calendar arithmetic)
    expect(run('=DATE(2026,13,1)')).toBe('2027-01-01');
    expect(run('=YEAR(DATE(2026,9,22))')).toBe(2026);
    expect(run('=TIME(13,30,5)')).toBe('13:30:05');
    expect(run('=TIME(25,0,0)')).toBe('01:00:00');
    expect(run('=HOUR(TIME(13,30,5))')).toBe(13);
  });

  it('DATEDIF computes Y/M/D/YM/YD/MD boundaries', () => {
    expect(run('=DATEDIF("2020-01-15","2026-09-22","Y")')).toBe(6);
    expect(run('=DATEDIF("2020-01-15","2026-09-22","M")')).toBe(80);
    expect(run('=DATEDIF("2020-01-15","2026-09-22","D")')).toBe(2442);
    expect(run('=DATEDIF("2020-01-15","2026-09-22","YM")')).toBe(8);
    expect(run('=DATEDIF("2026-01-15","2026-09-22","YD")')).toBe(250);
    expect(run('=DATEDIF("2026-09-22","2026-01-01","Y")')).toBe('#NUM!');
    expect(run('=DATEDIF("2026-01-01","2026-09-22","Q")')).toBe('#VALUE!');
  });

  it('LARGE / SMALL / MEDIAN over ranges', () => {
    const vals = { '0,0': 5, '1,0': 1, '2,0': 9, '3,0': 7 };
    expect(runWith(vals, '=LARGE(A1:A4,2)')).toBe(7);
    expect(runWith(vals, '=SMALL(A1:A4,2)')).toBe(5);
    expect(runWith(vals, '=MEDIAN(A1:A4)')).toBe(6);
    expect(run('=LARGE(A1:A2,5)')).toBe('#NUM!');
  });

  it('RANK.EQ ranks with ties (best rank), honors ascending order', () => {
    const vals = { '0,0': 90, '1,0': 70, '2,0': 90, '3,0': 60 };
    expect(runWith(vals, '=RANK.EQ(90,A1:A4)')).toBe(1);
    expect(runWith(vals, '=RANK.EQ(70,A1:A4)')).toBe(3);
    expect(runWith(vals, '=RANK.EQ(60,A1:A4,1)')).toBe(1);
    expect(runWith(vals, '=RANK.EQ(99,A1:A4)')).toBe('#N/A');
  });

  it('STDEV.P / STDEV.S (with legacy aliases) over ranges', () => {
    const vals = { '0,0': 2, '1,0': 4, '2,0': 4, '3,0': 4, '4,0': 5, '5,0': 5, '6,0': 7, '7,0': 9 };
    expect(runWith(vals, '=STDEV.P(A1:A8)')).toBeCloseTo(2, 10);
    expect(runWith(vals, '=STDEV.S(A1:A8)')).toBeCloseTo(2.13809, 4);
    expect(runWith(vals, '=STDEVP(A1:A8)')).toBeCloseTo(2, 10);
    expect(runWith(vals, '=STDEV(A1:A8)')).toBeCloseTo(2.13809, 4);
  });

  it('MAXIFS / MINIFS apply criteria pairs; 0 when nothing matches', () => {
    // A: 分数, B: 组别
    const vals = { '0,0': 80, '0,1': 'a', '1,0': 95, '1,1': 'b', '2,0': 70, '2,1': 'a', '3,0': 88, '3,1': 'a' };
    expect(runWith(vals, '=MAXIFS(A1:A4,B1:B4,"a")')).toBe(88);
    expect(runWith(vals, '=MINIFS(A1:A4,B1:B4,"a")')).toBe(70);
    expect(runWith(vals, '=MAXIFS(A1:A4,B1:B4,"z")')).toBe(0);
    expect(runWith(vals, '=MAXIFS(A1:A4,B1:B4,">a")')).toBe(95);
  });

  it('ROW/COLUMN read the formula cell without args, refs with args; ROWS/COLUMNS use range shape', () => {
    // run() places the formula at (4,4) → E5
    expect(run('=ROW()')).toBe(5);
    expect(run('=COLUMN()')).toBe(5);
    expect(run('=ROW(A10)')).toBe(10);
    expect(run('=COLUMN(C1)')).toBe(3);
    expect(run('=ROWS(A1:A10)')).toBe(10);
    expect(run('=COLUMNS(A1:C1)')).toBe(3);
    expect(run('=ROWS(B2)')).toBe(1);
  });
});
