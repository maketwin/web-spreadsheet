/**
 * Excel-style fill-series inference.
 *
 * Pure functions: given the source line of cell texts along the fill
 * direction, produce the continuation values. Returns `undefined` when the
 * line has no series pattern, so the caller falls back to plain copy.
 *
 * Excel semantics:
 * - Numbers: an arithmetic source continues exactly; a non-arithmetic source
 *   is extended along its least-squares trend line (Excel's TREND mechanism).
 *   A lone plain number is NOT a series by default (`singleNumberStep` opts
 *   in for the Ctrl-drag toggle).
 * - Dates (yyyy-mm-dd / yyyy/m/d / yyyy.m.d): step inferred from the source,
 *   one day for a lone date. Output keeps the separator and zero padding of
 *   the anchor cell.
 * - Text lists (weekdays/months, en + zh): step inferred like numbers, wraps.
 * - Text + trailing number (`Item1`): number continues, padding preserved.
 *
 * `direction: -1` continues the series *before* the first value (filling
 * upward/leftward), mirroring Excel's drag-up behavior.
 */

const WEEKDAYS_EN_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKDAYS_EN_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MONTHS_EN_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_EN_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS_ZH = ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'];
const MONTHS_ZH = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];

const TEXT_LISTS: readonly (readonly string[])[] = [
  WEEKDAYS_EN_SHORT, WEEKDAYS_EN_LONG,
  MONTHS_EN_SHORT, MONTHS_EN_LONG,
  WEEKDAYS_ZH, MONTHS_ZH,
];

const ISO_DATE = /^(\d{4})([-/.])(\d{1,2})\2(\d{1,2})$/;
const TEXT_NUMBER = /^(.*?)(\d+)$/;

export interface SeriesOptions {
  /** 1 continues after the last value (default); -1 continues before the first. */
  readonly direction?: 1 | -1;
  /** Excel Ctrl-drag toggle: a lone plain number increments instead of copying. */
  readonly singleNumberStep?: boolean;
}

/** Compute `count` continuation values for a source line. */
export function nextSeriesValues(source: readonly string[], count: number, opts: SeriesOptions = {}): string[] | undefined {
  const direction = opts.direction === -1 ? -1 : 1;
  if (source.length === 0 || count <= 0) return undefined;
  return numericSeries(source, count, direction, opts)
    ?? dateSeries(source, count, direction)
    ?? listSeries(source, count, direction)
    ?? textNumberSeries(source, count, direction);
}

function numericSeries(source: readonly string[], count: number, direction: 1 | -1, opts: SeriesOptions): string[] | undefined {
  const nums = source.map((t) => (t.trim().length > 0 ? Number(t) : NaN));
  if (nums.some((n) => Number.isNaN(n))) return undefined;
  const out: string[] = [];
  if (nums.length === 1) {
    if (opts.singleNumberStep !== true) return undefined;
    for (let i = 1; i <= count; i += 1) out.push(formatNumber(nums[0]! + direction * i));
    return out;
  }
  // Least-squares line through (i, nums[i]); arithmetic sources fit exactly.
  const n = nums.length;
  const meanX = (n - 1) / 2;
  const meanY = nums.reduce((a, b) => a + b, 0) / n;
  let cov = 0;
  let varX = 0;
  for (let i = 0; i < n; i += 1) {
    cov += (i - meanX) * (nums[i]! - meanY);
    varX += (i - meanX) * (i - meanX);
  }
  const slope = cov / varX;
  const intercept = meanY - slope * meanX;
  const firstX = direction === 1 ? n : -1;
  for (let i = 1; i <= count; i += 1) out.push(formatNumber(intercept + slope * (firstX + direction * (i - 1))));
  return out;
}

function formatNumber(n: number): string {
  // Avoid floating point artifacts like 0.30000000000000004.
  return String(Math.round(n * 1e10) / 1e10);
}

interface ParsedDate {
  readonly t: number;
  readonly sep: string;
  readonly padMonth: boolean;
  readonly padDay: boolean;
}

function parseDate(text: string): ParsedDate | undefined {
  const m = text.trim().match(ISO_DATE);
  if (m === null) return undefined;
  const year = Number(m[1]);
  const month = m[3] ?? '';
  const day = m[4] ?? '';
  const t = Date.UTC(year, Number(month) - 1, Number(day));
  const d = new Date(t);
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== Number(month) - 1 || d.getUTCDate() !== Number(day)) return undefined;
  return { t, sep: m[2] ?? '-', padMonth: month.length === 2, padDay: day.length === 2 };
}

function formatDate(parsed: ParsedDate, t: number): string {
  const d = new Date(t);
  const month = String(d.getUTCMonth() + 1);
  const day = String(d.getUTCDate());
  const monthText = parsed.padMonth ? month.padStart(2, '0') : month;
  const dayText = parsed.padDay ? day.padStart(2, '0') : day;
  return String(d.getUTCFullYear()) + parsed.sep + monthText + parsed.sep + dayText;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function dateSeries(source: readonly string[], count: number, direction: 1 | -1): string[] | undefined {
  const parsed = source.map(parseDate);
  if (parsed.some((p) => p === undefined)) return undefined;
  const dates = parsed as ParsedDate[];
  const first = dates[0]!;
  const last = dates[dates.length - 1]!;
  const anchor = direction === 1 ? last : first;
  // Average step keeps uniform sources exact and trends non-uniform ones.
  const stepDays = dates.length >= 2
    ? Math.round((last.t - first.t) / (dates.length - 1) / DAY_MS)
    : 1;
  const out: string[] = [];
  for (let i = 1; i <= count; i += 1) {
    out.push(formatDate(anchor, anchor.t + direction * stepDays * i * DAY_MS));
  }
  return out;
}

function findListEntry(text: string): { list: readonly string[]; index: number } | undefined {
  const lower = text.trim().toLowerCase();
  for (const list of TEXT_LISTS) {
    const index = list.findIndex((entry) => entry.toLowerCase() === lower);
    if (index >= 0) return { list, index };
  }
  return undefined;
}

function listSeries(source: readonly string[], count: number, direction: 1 | -1): string[] | undefined {
  // All source cells must belong to the same list, like Excel.
  const entries = source.map(findListEntry);
  const firstList = entries[0]?.list;
  if (firstList === undefined || entries.some((e) => e === undefined || e.list !== firstList)) return undefined;
  const len = firstList.length;
  const anchor = entries[direction === 1 ? entries.length - 1 : 0]!;
  const prev = entries.length >= 2 ? entries[direction === 1 ? entries.length - 2 : 1] : undefined;
  // Step in the source's own (forward) order; the loop applies the direction.
  const rawStep = prev !== undefined ? anchor.index - prev.index : 1;
  // Normalize wrapped steps (Sun→Mon reads as +1, not -6): pick the signed
  // step with the smallest magnitude, then apply the fill direction.
  let step = ((rawStep % len) + len) % len;
  if (step > len / 2) step -= len;
  const out: string[] = [];
  for (let i = 1; i <= count; i += 1) {
    const idx = ((anchor.index + direction * step * i) % len + len) % len;
    out.push(firstList[idx]!);
  }
  return out;
}

function textNumberSeries(source: readonly string[], count: number, direction: 1 | -1): string[] | undefined {
  const anchorText = source[direction === 1 ? source.length - 1 : 0]!;
  const m = anchorText.match(TEXT_NUMBER);
  if (m === null || (m[1] ?? '').length === 0) return undefined;
  const prefix = m[1] ?? '';
  const num = Number(m[2]);
  const width = (m[2] ?? '').length;
  const neighborText = source.length >= 2 ? source[direction === 1 ? source.length - 2 : 1] : undefined;
  const neighbor = neighborText !== undefined ? neighborText.match(TEXT_NUMBER) : null;
  const step = neighbor !== null && neighbor[1] === prefix ? num - Number(neighbor[2]) : 1;
  const out: string[] = [];
  for (let i = 1; i <= count; i += 1) {
    const next = num + direction * step * i;
    out.push(prefix + formatPadded(next, width));
  }
  return out;
}

function formatPadded(n: number, width: number): string {
  const sign = n < 0 ? '-' : '';
  const digits = String(Math.abs(n));
  const padded = width > 1 ? digits.padStart(width, '0') : digits;
  return sign + padded;
}
