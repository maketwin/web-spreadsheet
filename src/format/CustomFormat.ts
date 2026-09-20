/**
 * Excel-style custom number format strings (T3.1).
 *
 * Supported subset:
 * - sections `positive;negative;zero;text` (negative values use the absolute
 *   value in their own section, like Excel)
 * - numeric placeholders `0` (forced digit), `#` (optional digit), `?`
 *   (optional digit rendered as space), `,` thousands grouping, `.` decimal
 * - `%` (multiply by 100), scientific `E+00` / `E-00`
 * - date/time tokens `yyyy` `yy` `mmmm` `mmm` `mm` `dd` `hh` `ss` `AM/PM`
 *   (`mm` means minutes when adjacent to `h`/`ss`, months otherwise)
 * - literals: `"quoted text"`, `\x` escaped char, and other characters pass
 *   through verbatim
 *
 * Also supports `[Red]`/`[Blue]`/… color and `[>100]`/`[<=0]` condition
 * sections. Locale currency selectors like `[$¥-804]` are skipped.
 */

const EPOCH_MS = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export interface FormatCustomResult {
  readonly text: string;
  readonly color?: string;
}

interface CompiledSection {
  readonly kind: 'number' | 'date';
  /** token list: literal or placeholder */
  readonly tokens: readonly Token[];
  readonly intMinDigits: number;
  readonly intOptional: boolean;
  readonly groupThousands: boolean;
  readonly fracDigits: number;
  readonly fracOptional: number;
  readonly percent: boolean;
  readonly scientific: boolean;
  readonly ampm: boolean;
  readonly color?: string;
  readonly condition?: { readonly op: '>' | '<' | '>=' | '<=' | '=' | '<>'; readonly value: number };
}

type Token =
  | { readonly t: 'lit'; readonly s: string }
  | { readonly t: 'num' }
  | { readonly t: 'tok'; readonly s: string };

const cache = new Map<string, readonly CompiledSection[]>();

/** Format `value` with a custom format string. Returns undefined if unsupported. */
export function formatCustom(value: number | string, fmt: string): FormatCustomResult | undefined {
  const sections = compile(fmt);
  if (sections === undefined) return undefined;
  if (typeof value !== 'number') {
    const textSection = sections[3] ?? sections[0];
    if (textSection === undefined) return { text: String(value) };
    return withColor(renderText(String(value), textSection), textSection.color);
  }
  const picked = pickSection(sections, value);
  if (picked === undefined) return undefined;
  let v = value;
  // Classic 2nd section (negative) without a condition still formats |value|.
  if (picked.condition === undefined && value < 0 && sections.indexOf(picked) === 1) v = -value;
  return withColor(renderNumber(v, picked), picked.color);
}

function withColor(text: string, color: string | undefined): FormatCustomResult {
  return color === undefined ? { text } : { text, color };
}

function pickSection(sections: readonly CompiledSection[], value: number): CompiledSection | undefined {
  const conditioned = sections.filter((s) => s.condition !== undefined);
  if (conditioned.length > 0) {
    for (const s of sections) {
      if (s.condition === undefined) continue;
      if (matchCondition(value, s.condition)) return s;
    }
    // Excel: if no condition matches, use the first section without a condition, else last.
    return sections.find((s) => s.condition === undefined) ?? sections[sections.length - 1];
  }
  let section = sections[0]!;
  if (value < 0 && sections.length >= 2) section = sections[1]!;
  else if (value === 0 && sections.length >= 3) section = sections[2]!;
  return section;
}

function matchCondition(value: number, cond: NonNullable<CompiledSection['condition']>): boolean {
  switch (cond.op) {
    case '>': return value > cond.value;
    case '<': return value < cond.value;
    case '>=': return value >= cond.value;
    case '<=': return value <= cond.value;
    case '<>': return value !== cond.value;
    default: return value === cond.value;
  }
}

function compile(fmt: string): readonly CompiledSection[] | undefined {
  const hit = cache.get(fmt);
  if (hit !== undefined) return hit;
  const raw = splitSections(fmt);
  if (raw.length === 0 || raw.length > 8) return undefined;
  const sections = raw.map((sec, i) => compileSection(sec, i));
  if (sections.some((s) => s === undefined)) return undefined;
  const compiled = sections as readonly CompiledSection[];
  cache.set(fmt, compiled);
  return compiled;
}

function splitSections(fmt: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < fmt.length; i += 1) {
    const ch = fmt[i]!;
    if (ch === '"') { inQuote = !inQuote; cur += ch; continue; }
    if (ch === '\\' && i + 1 < fmt.length) { cur += ch + fmt[i + 1]!; i += 1; continue; }
    if (ch === ';' && !inQuote) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.filter((s, i) => s.length > 0 || i === 0);
}

const NAMED_COLORS: Record<string, string> = {
  red: '#FF0000',
  blue: '#0000FF',
  green: '#008000',
  black: '#000000',
  white: '#FFFFFF',
  yellow: '#FFFF00',
  cyan: '#00FFFF',
  magenta: '#FF00FF',
};

const DATE_TOKEN = /^(yyyy|yy|mmmm|mmm|mm|dd|hh|ss|AM\/PM|am\/pm)/i;

function compileSection(src: string, index: number): CompiledSection | undefined {
  const tokens: Token[] = [];
  let color: string | undefined;
  let condition: CompiledSection['condition'];
  let intMinDigits = 0;
  let intOptional = false;
  let groupThousands = false;
  let fracDigits = 0;
  let fracOptional = 0;
  let percent = false;
  let scientific = false;
  let ampm = false;
  let hasNum = false;
  let hasDate = false;
  let seenDot = false;
  let lastSig = '';
  let prevTok = '';

  let i = 0;
  let literal = '';
  const flushLit = (): void => { if (literal.length > 0) { tokens.push({ t: 'lit', s: literal }); literal = ''; } };

  while (i < src.length) {
    const ch = src[i]!;
    if (ch === '"') {
      const end = src.indexOf('"', i + 1);
      if (end < 0) return undefined;
      literal += src.slice(i + 1, end);
      i = end + 1;
      continue;
    }
    if (ch === '\\' && i + 1 < src.length) { literal += src[i + 1]!; i += 2; continue; }
    if (ch === '[') {
      const end = src.indexOf(']', i + 1);
      if (end < 0) return undefined;
      const inner = src.slice(i + 1, end).trim();
      if (inner.startsWith('$')) { i = end + 1; continue; } // locale/currency — skip
      const named = NAMED_COLORS[inner.toLowerCase()];
      if (named !== undefined) { color = named; i = end + 1; continue; }
      const cm = /^(>=|<=|<>|>|<|=)\s*([+-]?\d+(?:\.\d+)?)$/.exec(inner);
      if (cm !== null) {
        condition = { op: cm[1] as NonNullable<CompiledSection['condition']>['op'], value: Number(cm[2]) };
        i = end + 1;
        continue;
      }
      // Unknown bracket — ignore rather than fail the whole format.
      i = end + 1;
      continue;
    }
    const rest = src.slice(i);
    const dm = DATE_TOKEN.exec(rest);
    if (dm !== null) {
      flushLit();
      let tok = dm[1]!;
      const isAmPm = /^am\/pm$/i.test(tok);
      if (isAmPm) { ampm = true; tok = 'AM/PM'; }
      let resolved = tok;
      if (tok === 'mm') {
        // minutes when preceded by h or followed by ss
        const after = src.slice(i + 2).trimStart().toLowerCase();
        resolved = prevTok === 'hh' || after.startsWith('ss') ? 'min' : 'mm';
      }
      tokens.push({ t: 'tok', s: resolved });
      prevTok = resolved;
      hasDate = true;
      i += dm[1]!.length;
      continue;
    }
    if (ch === '0' || ch === '#' || ch === '?') {
      flushLit();
      if (!tokens.some((t) => t.t === 'num')) tokens.push({ t: 'num' });
      if (seenDot) { if (ch === '0') fracDigits += 1; else fracOptional += 1; }
      else if (ch === '0') intMinDigits += 1;
      else intOptional = true;
      hasNum = true;
      lastSig = ch;
      i += 1;
      continue;
    }
    if (ch === '.') {
      if (seenDot) return undefined;
      seenDot = true;
      if (tokens.some((t) => t.t === 'num') === false) tokens.push({ t: 'num' });
      hasNum = true;
      i += 1;
      continue;
    }
    if (ch === ',') { if (hasNum && !seenDot) groupThousands = true; i += 1; continue; }
    if (ch === '@') {
      flushLit();
      tokens.push({ t: 'num' });
      hasNum = true;
      i += 1;
      continue;
    }
    if (ch === '%') { literal += '%'; percent = true; i += 1; continue; }
    if (/^e[+-]0+$/i.test(rest.slice(0, 3)) || /^E[+-]/i.test(rest)) {
      scientific = true;
      const m = /^[eE][+-]0*/.exec(rest);
      i += m !== null ? Math.max(m[0].length, 3) : 3;
      continue;
    }
    literal += ch;
    i += 1;
  }
  flushLit();
  void lastSig;
  const isTextSection = index === 3;
  if (!hasNum && !hasDate && index < 2) return undefined;
  if (isTextSection && !tokens.some((t) => t.t === 'num')) return undefined;
  return {
    kind: hasDate && !hasNum ? 'date' : 'number',
    tokens, intMinDigits, intOptional, groupThousands, fracDigits, fracOptional, percent, scientific, ampm,
    ...(color !== undefined ? { color } : {}),
    ...(condition !== undefined ? { condition } : {}),
  };
}

function renderNumber(value: number, s: CompiledSection): string {
  if (s.kind === 'date') return renderDate(value, s);
  const scaled = s.percent ? value * 100 : value;
  const body = s.scientific ? sciBody(scaled, s) : fixedBody(scaled, s);
  return substituteNum(s.tokens, body, s.ampm);
}

function fixedBody(value: number, s: CompiledSection): string {
  const totalFrac = s.fracDigits + s.fracOptional;
  const fixed = value.toFixed(totalFrac);
  const [intPartRaw, fracRaw = ''] = fixed.split('.');
  let intPart = intPartRaw!;
  if (s.groupThousands) intPart = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  if (intPart.length < s.intMinDigits) intPart = intPart.padStart(s.intMinDigits, '0');
  // Optional fraction slots: strip trailing zeros beyond the forced digits.
  let frac = fracRaw;
  while (frac.length > s.fracDigits && frac.endsWith('0')) frac = frac.slice(0, -1);
  return frac.length > 0 ? `${intPart}.${frac}` : intPart;
}

function sciBody(value: number, s: CompiledSection): string {
  const exp = value.toExponential(s.fracDigits);
  const [mantissa, e] = exp.split('e');
  const sign = e!.startsWith('-') ? '-' : '+';
  const digits = e!.replace(/^[+-]/, '').padStart(2, '0');
  void s;
  return `${mantissa}E${sign}${digits}`;
}

function substituteNum(tokens: readonly Token[], body: string, ampm: boolean): string {
  let out = '';
  let placed = false;
  for (const t of tokens) {
    if (t.t === 'lit') out += t.s;
    else if (t.t === 'num') { if (!placed) { out += body; placed = true; } }
    else if (t.t === 'tok' && ampm) out += t.s === 'AM/PM' ? 'AM' : t.s;
  }
  if (!placed && tokens.length === 0) out += body;
  return out;
}

function renderText(text: string, s: CompiledSection): string {
  // Text section: '@' placeholder stands for the text (first occurrence).
  let out = '';
  let placed = false;
  for (const t of s.tokens) {
    if (t.t === 'lit') out += t.s;
    else if (!placed) { out += text; placed = true; }
  }
  return out === '' ? text : out;
}

function renderDate(serial: number, s: CompiledSection): string {
  const ms = EPOCH_MS + Math.round(serial * DAY_MS);
  const d = new Date(ms);
  const hours24 = d.getUTCHours();
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  let out = '';
  for (const t of s.tokens) {
    if (t.t === 'lit') { out += t.s; continue; }
    if (t.t === 'num') { continue; }
    switch (t.s) {
      case 'yyyy': out += String(d.getUTCFullYear()); break;
      case 'yy': out += String(d.getUTCFullYear() % 100).padStart(2, '0'); break;
      case 'mmmm': out += MONTHS_LONG[d.getUTCMonth()]!; break;
      case 'mmm': out += MONTHS_SHORT[d.getUTCMonth()]!; break;
      case 'mm': out += String(d.getUTCMonth() + 1).padStart(2, '0'); break;
      case 'dd': out += String(d.getUTCDate()).padStart(2, '0'); break;
      case 'hh': out += String(s.ampm ? hours12 : hours24).padStart(2, '0'); break;
      case 'min': out += String(d.getUTCMinutes()).padStart(2, '0'); break;
      case 'ss': out += String(d.getUTCSeconds()).padStart(2, '0'); break;
      case 'AM/PM': out += hours24 < 12 ? 'AM' : 'PM'; break;
      default: out += t.s;
    }
  }
  return out;
}
