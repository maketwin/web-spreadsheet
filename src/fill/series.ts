/**
 * Excel-style fill-series inference (T2.1).
 *
 * Pure functions: given the source line of cell texts along the fill
 * direction, produce the continuation values. Returns `undefined` when the
 * line has no series pattern, so the caller falls back to plain copy.
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

const ISO_DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const TEXT_NUMBER = /^(.*?)(\d+)$/;

/**
 * Compute `count` continuation values for a source line. When the source has
 * two or more values, the trend step is inferred from the last pair (like
 * Excel's linear trend for numbers); a single value steps by 1 / 1 day /
 * next list entry.
 */
export function nextSeriesValues(source: readonly string[], count: number): string[] | undefined {
  if (source.length === 0 || count <= 0) return undefined;
  return numericSeries(source, count)
    ?? dateSeries(source, count)
    ?? listSeries(source, count)
    ?? textNumberSeries(source, count);
}

function numericSeries(source: readonly string[], count: number): string[] | undefined {
  const nums = source.map((t) => (t.trim().length > 0 ? Number(t) : NaN));
  if (nums.some((n) => Number.isNaN(n))) return undefined;
  const last = nums[nums.length - 1]!;
  const step = nums.length >= 2 ? last - nums[nums.length - 2]! : 1;
  const out: string[] = [];
  for (let i = 1; i <= count; i += 1) out.push(formatNumber(last + step * i));
  return out;
}

function formatNumber(n: number): string {
  // Avoid floating point artifacts like 0.30000000000000004.
  return String(Math.round(n * 1e10) / 1e10);
}

function parseIsoDay(text: string): number | undefined {
  const m = ISO_DATE.exec(text.trim());
  if (m === null) return undefined;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(t);
  if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1) return undefined;
  return t;
}

function formatIsoDay(t: number): string {
  const d = new Date(t);
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${d.getUTCFullYear()}-${mm}-${dd}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function dateSeries(source: readonly string[], count: number): string[] | undefined {
  const days = source.map(parseIsoDay);
  if (days.some((d) => d === undefined)) return undefined;
  const last = days[days.length - 1]!;
  const stepDays = days.length >= 2 ? Math.round((last - days[days.length - 2]!) / DAY_MS) : 1;
  const out: string[] = [];
  for (let i = 1; i <= count; i += 1) out.push(formatIsoDay(last + stepDays * i * DAY_MS));
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

function listSeries(source: readonly string[], count: number): string[] | undefined {
  const last = findListEntry(source[source.length - 1]!);
  if (last === undefined) return undefined;
  const out: string[] = [];
  for (let i = 1; i <= count; i += 1) {
    out.push(last.list[(last.index + i) % last.list.length]!);
  }
  return out;
}

function textNumberSeries(source: readonly string[], count: number): string[] | undefined {
  const last = source[source.length - 1]!;
  const m = TEXT_NUMBER.exec(last);
  if (m === null || m[1]!.length === 0) return undefined;
  const prefix = m[1]!;
  const num = Number(m[2]!);
  const width = m[2]!.length;
  const prev = source.length >= 2 ? TEXT_NUMBER.exec(source[source.length - 2]!) : null;
  const step = prev !== null && prev![1] === prefix ? num - Number(prev![2]!) : 1;
  const out: string[] = [];
  for (let i = 1; i <= count; i += 1) {
    const next = num + step * i;
    const padded = width > 1 ? String(next).padStart(width, '0') : String(next);
    out.push(`${prefix}${padded}`);
  }
  return out;
}
