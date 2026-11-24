/**
 * XML entity decoding shared by the regex-based xlsx importers. Pure string
 * handling on purpose: the decoders run inside the xlsx Web Worker where
 * `DOMParser` is unavailable, so this must stay Worker-safe.
 */

/** `&#xHH;` (hex) or `&#NN;` (decimal) numeric character reference. */
const NUMERIC_ENTITY = /&#(?:(x[0-9A-Fa-f]+)|(\d+));/g;

function codePointOf(hex: string | undefined, dec: string | undefined, raw: string): string {
  const cp = Number.parseInt(hex ?? dec!, hex !== undefined ? 16 : 10);
  // A hostile file can reference an out-of-range code point; keep the raw text
  // instead of letting String.fromCodePoint throw inside the import path.
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : raw;
}

/**
 * Decodes the five predefined XML entities plus numeric character references
 * (`&#NN;`, `&#xHH;`). `&amp;` decodes last and numeric refs decode before it,
 * so one call unwraps exactly one escaping round: `&amp;lt;` → the literal
 * text `&lt;` (not `<`), and `&amp;#38;` → `&#38;` (not `&`).
 */
export function decodeXmlEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replace(NUMERIC_ENTITY, (raw, hex: string | undefined, dec: string | undefined) => codePointOf(hex, dec, raw))
    .replaceAll('&amp;', '&');
}
