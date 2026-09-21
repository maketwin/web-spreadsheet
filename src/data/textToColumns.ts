/** Excel-style Text to Columns (delimiter mode) — pure split. */

export type TextToColumnsDelimiter = 'tab' | 'semicolon' | 'comma' | 'space' | 'custom';

export interface TextToColumnsOptions {
  readonly delimiter: TextToColumnsDelimiter;
  /** Used when delimiter === 'custom'. */
  readonly custom?: string;
  /** Excel "Treat consecutive delimiters as one". */
  readonly consecutiveAsOne?: boolean;
}

export function delimiterChar(opts: TextToColumnsOptions): string {
  switch (opts.delimiter) {
    case 'tab': return '\t';
    case 'semicolon': return ';';
    case 'comma': return ',';
    case 'space': return ' ';
    case 'custom': return opts.custom ?? '';
  }
}

/** Split one cell's text into column parts. */
export function splitCellText(text: string, opts: TextToColumnsOptions): string[] {
  const d = delimiterChar(opts);
  if (d === '') return [text];
  const parts = text.split(d);
  if (opts.consecutiveAsOne === true) return parts.filter((p) => p !== '');
  return parts;
}

/** Split each source row; pad to max width. */
export function splitColumnValues(
  texts: readonly string[],
  opts: TextToColumnsOptions,
): string[][] {
  const rows = texts.map((t) => splitCellText(t, opts));
  const width = Math.max(1, ...rows.map((r) => r.length));
  return rows.map((r) => {
    const padded = [...r];
    while (padded.length < width) padded.push('');
    return padded;
  });
}
