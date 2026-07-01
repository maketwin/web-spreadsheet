import type { Style } from '../types';

export type NumberFormatType = NonNullable<Style['numberFormat']>;

export interface FormatResult {
  readonly text: string;
  readonly formatted: boolean;
}

/** Format a cell value according to the number format type. */
export function formatValue(value: unknown, fmt: NumberFormatType): FormatResult {
  if (value === null || value === undefined) return { text: '', formatted: false };
  if (fmt === 'general') return { text: String(value), formatted: false };
  if (typeof value !== 'number') return { text: String(value), formatted: false };

  switch (fmt) {
    case 'number': return formatNumber(value);
    case 'currency': return formatCurrency(value);
    case 'percent': return formatPercent(value);
    case 'date': return formatDate(value);
    case 'time': return formatTime(value);
    case 'scientific': return formatScientific(value);
    default: return { text: String(value), formatted: false };
  }
}

function formatNumber(value: number): FormatResult {
  const formatted = value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return { text: formatted, formatted: true };
}

function formatCurrency(value: number): FormatResult {
  const formatted = value.toLocaleString('zh-CN', { style: 'currency', currency: 'CNY', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return { text: formatted, formatted: true };
}

function formatPercent(value: number): FormatResult {
  const formatted = `${(value * 100).toFixed(2)}%`;
  return { text: formatted, formatted: true };
}

function formatDate(value: number): FormatResult {
  // Treat value as Excel serial date number (days since 1900-01-01)
  const date = serialToDate(value);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return { text: `${y}-${m}-${d}`, formatted: true };
}

function formatTime(value: number): FormatResult {
  // Treat value as fractional day (0.5 = noon)
  const totalSeconds = Math.round(value * 86400);
  const hours = Math.floor(totalSeconds / 3600) % 24;
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const h = String(hours).padStart(2, '0');
  const min = String(minutes).padStart(2, '0');
  const sec = String(seconds).padStart(2, '0');
  return { text: `${h}:${min}:${sec}`, formatted: true };
}

function formatScientific(value: number): FormatResult {
  const formatted = value.toExponential(2);
  return { text: formatted, formatted: true };
}

/** Convert Excel serial date number to a JS Date. */
function serialToDate(serial: number): Date {
  // Excel epoch: 1900-01-01 = serial 1, with the 1900 leap year bug (serial 60 = 1900-02-29)
  const epochMs = Date.UTC(1899, 11, 30); // 1899-12-30
  const ms = epochMs + Math.round(serial * 86400000);
  return new Date(ms);
}
