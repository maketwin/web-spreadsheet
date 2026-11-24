import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { FormulaParser } from '../../src/formula/parser';
import { evaluate } from '../../src/formula/evaluator';
import { FormulaEngine } from '../../src/formula/FormulaEngine';
import type { CellResolver, FormulaValue } from '../../src/formula/types';
import { Store } from '../../src/store/Store';
import { formatValue } from '../../src/format/NumberFormatter';
import { importXlsx } from '../../src/io/XlsxImporter';

const parser = new FormulaParser();

/** Evaluate `=expr` with A1-style cells served from `cells` (absent keys are blank cells). */
function calc(expr: string, cells: Record<string, FormulaValue> = {}): FormulaValue {
  const ast = parser.parse(expr);
  if (ast === null) throw new Error(`parse failed: ${expr}`);
  const resolve: CellResolver = (x, y) => cells[`${String.fromCharCode(65 + x)}${y + 1}`] ?? null;
  const result = evaluate(ast, resolve);
  return (Array.isArray(result) ? (result[0] ?? null) : result) as FormulaValue;
}

/** The value a cell ends up holding after the engine computed `formula` in it. */
function cellValue(formula: string): unknown {
  const store = new Store();
  const engine = new FormulaEngine(store);
  store.setCell(0, 0, { formula, text: '' });
  engine.setFormula('0,0', formula, []);
  return store.getCell(0, 0)?.value;
}

describe('DATE() is the Excel serial number', () => {
  it('returns the number Excel itself stores for that day', () => {
    expect(calc('=DATE(2024,1,1)')).toBe(45292);
    expect(calc('=DATE(2000,1,1)')).toBe(36526);
    expect(calc('=DATE(2026,9,22)')).toBe(46287);
    expect(calc('=DATE(1900,3,1)')).toBe(61); // first day after Excel's phantom 1900-02-29
    expect(typeof calc('=DATE(2024,1,1)')).toBe('number');
  });

  it('equals what importXlsx leaves in a date cell, and shows the same under that cell format', () => {
    // What an Excel file holds for a date: a plain number plus a date number format.
    const ws = XLSX.utils.aoa_to_sheet([[45292, 46287, 45292.5625]]);
    ws['A1']!.z = 'yyyy-mm-dd';
    ws['B1']!.z = 'yyyy/m/d';
    ws['C1']!.z = 'yyyy-mm-dd hh:mm';
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'S1');
    const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;

    const sheet = importXlsx(buffer).sheets[0]!.data;
    const cells = new Map(sheet.cells as Array<[string, { value?: number; type?: string; styleId?: string }]>);
    const styles = new Map(sheet.styles as Array<[string, { numberFormat?: string }]>);

    const a1 = cells.get('0,0');
    expect(a1?.type).toBe('date');
    expect(calc('=DATE(2024,1,1)')).toBe(a1?.value);
    expect(calc('=DATE(2026,9,22)')).toBe(cells.get('0,1')?.value);
    // A time of day is the fraction of the day: 13:30 is 0.5625.
    expect(calc('=DATE(2024,1,1)+13.5/24')).toBe(cells.get('0,2')?.value);
    // The imported cell shows its date through its number format; the formula serial shows the same.
    const a1Format = styles.get(a1?.styleId ?? '')?.numberFormat;
    expect(a1Format).toBe('date'); // the importer maps yyyy-mm-dd onto the built-in date format
    expect(formatValue(calc('=DATE(2024,1,1)'), a1Format!).text).toBe('2024-01-01');
    expect(formatValue(calc('=DATE(2026,9,22)'), 'yyyy/m/d').text).toBe('2026/9/22');
  });

  it('adds and subtracts like the number it is', () => {
    expect(calc('=DATE(2024,1,1)+1')).toBe(45293);
    expect(calc('=DATE(2024,1,1)-1')).toBe(45291);
    expect(calc('=DATE(2024,1,1)*2')).toBe(90584);
    expect(calc('=SUM(DATE(2024,1,1),1)')).toBe(45293);
    expect(calc('=DATE(2024,1,32)')).toBe(calc('=DATE(2024,2,1)'));
    expect(calc('=DATE(2024,3,1)-DATE(2024,2,1)')).toBe(29); // 2024 is a leap year
    expect(cellValue('=DATE(2024,1,1)+1')).toBe(45293);
    expect(cellValue('=DATE(2024,1,1)+1&""')).toBe('45293');
  });

  it('normalizes month and day overflow (Excel calendar arithmetic)', () => {
    expect(calc('=DATE(2026,13,1)')).toBe(calc('=DATE(2027,1,1)'));
    expect(calc('=DATE(2024,0,15)')).toBe(calc('=DATE(2023,12,15)'));
    expect(calc('=DATE(2024,1,0)')).toBe(calc('=DATE(2023,12,31)'));
    expect(calc('=DATE(2024,2,30)')).toBe(calc('=DATE(2024,3,1)'));
    expect(calc('=DATE(2024,2,29)')).toBe((calc('=DATE(2024,3,1)') as number) - 1);
  });

  it('rejects text and years outside 0..9999', () => {
    expect(calc('=DATE(2024,1,"x")')).toBe('#VALUE!');
    expect(calc('=DATE(10000,1,1)')).toBe('#NUM!');
  });
});

describe('TODAY() / NOW()', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 23, 13, 30, 5)); // local wall clock: 2026-11-23 13:30:05
  });
  afterEach(() => { vi.useRealTimers(); });

  it('TODAY() is today at midnight, as a serial number that takes part in arithmetic', () => {
    const today = calc('=TODAY()');
    expect(typeof today).toBe('number');
    expect(Number.isInteger(today)).toBe(true);
    expect(calc('=YEAR(TODAY())')).toBe(2026);
    expect(calc('=MONTH(TODAY())')).toBe(11);
    expect(calc('=DAY(TODAY())')).toBe(23);
    expect(calc('=HOUR(TODAY())')).toBe(0);
    expect(calc('=TODAY()-1')).toBe((today as number) - 1); // used to be #VALUE!
    expect(calc('=TODAY()+1-DATE(2026,11,23)')).toBe(1);
    expect(calc('=TODAY()=DATE(2026,11,23)')).toBe(true);
  });

  it('HOUR(NOW()) is the hour on the local wall clock, not the UTC hour', () => {
    expect(typeof calc('=NOW()')).toBe('number');
    expect(calc('=HOUR(NOW())')).toBe(13); // used to come out as 5 in UTC+8
    expect(calc('=MINUTE(NOW())')).toBe(30);
    expect(calc('=SECOND(NOW())')).toBe(5);
    expect(calc('=YEAR(NOW())')).toBe(2026);
    expect(calc('=MONTH(NOW())')).toBe(11);
    expect(calc('=DAY(NOW())')).toBe(23);
    // NOW() is TODAY() plus the elapsed fraction of the day.
    expect(calc('=NOW()-TODAY()')).toBeCloseTo((13 * 3600 + 30 * 60 + 5) / 86400, 9);
    // 13:30:00 is five seconds behind NOW().
    expect(calc('=TODAY()+13.5/24-NOW()')).toBeCloseTo(-5 / 86400, 9);
    expect(calc('=INT(NOW())')).toBe(calc('=TODAY()'));
  });

  it('stays right just before and just after midnight', () => {
    vi.setSystemTime(new Date(2026, 10, 23, 23, 59, 59));
    expect(calc('=HOUR(NOW())')).toBe(23);
    expect(calc('=DAY(NOW())')).toBe(23);
    expect(calc('=MINUTE(NOW())')).toBe(59);
    const lateEvening = calc('=NOW()') as number;
    vi.setSystemTime(new Date(2026, 10, 24, 0, 0, 0));
    expect(calc('=HOUR(NOW())')).toBe(0);
    expect(calc('=DAY(NOW())')).toBe(24);
    expect(calc('=NOW()')).toBeCloseTo(Math.floor(lateEvening) + 1, 9);
  });

  it('does not depend on the machine time zone for a date written in a file', () => {
    // A serial is a wall-clock date with no zone: 45292.5 is noon on 2024-01-01 wherever it is read.
    expect(calc('=HOUR(45292.5)')).toBe(12);
    expect(calc('=DAY(45292.5)')).toBe(1);
    expect(calc('=MONTH(45292.5)')).toBe(1);
  });
});

describe('YEAR / MONTH / DAY / HOUR / MINUTE / SECOND read a serial number', () => {
  it('read the date fields of a whole-day serial', () => {
    expect(calc('=YEAR(45292)')).toBe(2024);
    expect(calc('=MONTH(45292)')).toBe(1);
    expect(calc('=DAY(45292)')).toBe(1);
    expect(calc('=DAY(45292+30)')).toBe(31);
    expect(calc('=MONTH(45292+31)')).toBe(2);
    expect(calc('=YEAR(DATE(2026,9,22))')).toBe(2026);
  });

  it('read the time fields of a serial with a fraction of a day', () => {
    expect(calc('=HOUR(45292.5)')).toBe(12);
    expect(calc('=MINUTE(45292.520833333336)')).toBe(30); // 12:30
    expect(calc('=SECOND(45292.000011574)')).toBe(1); // one second past midnight
    expect(calc('=HOUR(DATE(2024,1,1)+13/24)')).toBe(13);
    expect(calc('=MINUTE(DATE(2024,1,1)+(13*3600+59*60+59)/86400)')).toBe(59);
    expect(calc('=SECOND(DATE(2024,1,1)+(13*3600+59*60+59)/86400)')).toBe(59);
  });

  it('still accept date and time text, with either separator', () => {
    expect(calc('=YEAR("2024-03-05")')).toBe(2024);
    expect(calc('=MONTH("2024-03-05")')).toBe(3);
    expect(calc('=DAY("2024/3/5")')).toBe(5);
    expect(calc('=DAY("2024-03-05 23:30:00")')).toBe(5);
    expect(calc('=HOUR("2024-03-05 23:30:00")')).toBe(23);
    expect(calc('=HOUR("13:30:05")')).toBe(13);
    expect(calc('=MINUTE("13:30")')).toBe(30);
    expect(calc('=SECOND("13:30:05")')).toBe(5);
    expect(calc('=DAY("45292")')).toBe(1);
  });

  it('read a JS Date the host put in a cell by its local reading', () => {
    const stamp = new Date(2024, 2, 5, 7, 8, 9);
    const cell = { A1: stamp };
    expect(calc('=YEAR(A1)', cell)).toBe(2024);
    expect(calc('=MONTH(A1)', cell)).toBe(3);
    expect(calc('=DAY(A1)', cell)).toBe(5);
    expect(calc('=HOUR(A1)', cell)).toBe(7);
    expect(calc('=MINUTE(A1)', cell)).toBe(8);
    expect(calc('=SECOND(A1)', cell)).toBe(9);
  });

  it('are #VALUE! for a value that is no date', () => {
    expect(calc('=YEAR("abc")')).toBe('#VALUE!');
    expect(calc('=HOUR("abc")')).toBe('#VALUE!');
    expect(calc('=MINUTE(A1)', { A1: 'soon' })).toBe('#VALUE!');
  });
});

describe('TEXT() with date and time formats', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 23, 13, 30, 5));
  });
  afterEach(() => { vi.useRealTimers(); });

  it('formats the DATE() serial with the common date formats', () => {
    // [format, 2024-01-01, the day after (=DATE(2024,1,1)+1)]
    const cases: ReadonlyArray<readonly [string, string, string]> = [
      ['yyyy-mm-dd', '2024-01-01', '2024-01-02'],
      ['yyyy/m/d', '2024/1/1', '2024/1/2'],
      ['mm/dd/yyyy', '01/01/2024', '01/02/2024'],
      ['dd/mm/yyyy', '01/01/2024', '02/01/2024'],
      ['d-mmm-yyyy', '1-Jan-2024', '2-Jan-2024'],
      ['d mmmm yyyy', '1 January 2024', '2 January 2024'],
      ['m/d/yy', '1/1/24', '1/2/24'],
      ['yyyy', '2024', '2024'],
      ['mm-dd', '01-01', '01-02'],
    ];
    for (const [format, first, next] of cases) {
      expect(calc(`=TEXT(DATE(2024,1,1),"${format}")`), format).toBe(first);
      expect(calc(`=TEXT(DATE(2024,1,1)+1,"${format}")`), format).toBe(next);
    }
  });

  it('formats a time of day', () => {
    expect(calc('=TEXT(NOW(),"hh:mm:ss")')).toBe('13:30:05');
    expect(calc('=TEXT(NOW(),"yyyy-mm-dd hh:mm")')).toBe('2026-11-23 13:30');
    expect(calc('=TEXT(NOW(),"h:mm AM/PM")')).toBe('1:30 PM');
    expect(calc('=TEXT(45292.5,"hh:mm")')).toBe('12:00');
    expect(calc('=TEXT(0.75,"h:mm AM/PM")')).toBe('6:00 PM');
  });

  it('formats a date read from text as well', () => {
    expect(calc('=TEXT("2024-03-05","yyyy/mm/dd")')).toBe('2024/03/05');
    expect(calc('=TEXT(TIME(13,30,5),"hh:mm")')).toBe('13:30');
  });

  it('leaves the number formats and the fallbacks as they were', () => {
    expect(calc('=TEXT(1.2,"0.00")')).toBe('1.20');
    expect(calc('=TEXT(1234.5,"#,##0")')).toBe('1,235');
    expect(calc('=TEXT(DATE(2024,1,1),"0")')).toBe('45292');
    expect(calc('=TEXT("abc","yyyy-mm-dd")')).toBe('abc');
  });
});
