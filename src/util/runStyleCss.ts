import type { CSSProperties } from 'react';
import type { RunStyle } from '../types';

/**
 * RunStyle ↔ CSS inline-style mapping shared by the clipboard HTML flavor and
 * the contenteditable rich editor (both must round-trip identically): spans
 * are written with {@link runSpanStyle} and parsed back with
 * {@link runStyleFromElement}.
 */

/** Inline CSS for one run's overrides (empty string when the run is unstyled). */
export function runSpanStyle(style: RunStyle): string {
  const parts: string[] = [];
  if (style.bold === true) parts.push('font-weight:700');
  if (style.italic === true) parts.push('font-style:italic');
  const deco = [style.underline === true ? 'underline' : '', style.strike === true ? 'line-through' : ''].filter(Boolean).join(' ');
  if (deco !== '') parts.push(`text-decoration:${deco}`);
  if (style.fontSize !== undefined) parts.push(`font-size:${style.fontSize}pt`);
  if (style.fontFamily !== undefined) parts.push(`font-family:'${style.fontFamily.replace(/'/g, '')}'`);
  if (style.color !== undefined) parts.push(`color:${style.color}`);
  if (style.vertAlign === 'subscript') parts.push('vertical-align:sub');
  if (style.vertAlign === 'superscript') parts.push('vertical-align:super');
  return parts.join(';');
}

/** React-friendly form for editor spans. */
export function runSpanCss(style: RunStyle | undefined): CSSProperties | undefined {
  if (style === undefined) return undefined;
  const css: CSSProperties = {};
  const span = runSpanStyle(style);
  if (span === '') return undefined;
  for (const decl of span.split(';')) {
    const sep = decl.indexOf(':');
    if (sep < 0) continue;
    const prop = decl.slice(0, sep).trim();
    const value = decl.slice(sep + 1).trim();
    switch (prop) {
      case 'font-weight': (css as Record<string, unknown>).fontWeight = value; break;
      case 'font-style': (css as Record<string, unknown>).fontStyle = value; break;
      case 'text-decoration': (css as Record<string, unknown>).textDecoration = value; break;
      case 'font-size': (css as Record<string, unknown>).fontSize = value; break;
      case 'font-family': (css as Record<string, unknown>).fontFamily = value.replaceAll("'", ''); break;
      case 'color': (css as Record<string, unknown>).color = value; break;
      case 'vertical-align': (css as Record<string, unknown>).verticalAlign = value; break;
      default: break;
    }
  }
  return css;
}

/** Inline CSS + semantic tags (`b`, `sub`, …) → RunStyle, the way clipboard HTML spells them. */
export function runStyleFromElement(el: HTMLElement): RunStyle {
  const style: RunStyle = {};
  const tag = el.tagName.toLowerCase();
  if (tag === 'b' || tag === 'strong') style.bold = true;
  if (tag === 'i' || tag === 'em') style.italic = true;
  if (tag === 'u') style.underline = true;
  if (tag === 's' || tag === 'strike' || tag === 'del') style.strike = true;
  if (tag === 'sub') style.vertAlign = 'subscript';
  if (tag === 'sup') style.vertAlign = 'superscript';
  const css = el.style;
  const weight = css.fontWeight;
  if (weight === 'bold' || weight === '700' || weight === '800' || weight === '900') style.bold = true;
  if (css.fontStyle === 'italic') style.italic = true;
  const deco = css.textDecoration;
  if (deco.includes('underline')) style.underline = true;
  if (deco.includes('line-through')) style.strike = true;
  const size = css.fontSize;
  if (size !== undefined && size !== '') {
    const pt = Number(size.replace(/pt.*$/, ''));
    if (Number.isFinite(pt) && pt > 0) style.fontSize = Math.round(pt);
  }
  const family = css.fontFamily;
  if (family !== undefined && family !== '') style.fontFamily = firstFontFamily(family);
  const color = css.color;
  if (color !== undefined && color !== '') {
    const parsed = parseCssColor(color);
    if (parsed !== undefined) style.color = parsed;
  }
  if (css.verticalAlign === 'sub') style.vertAlign = 'subscript';
  if (css.verticalAlign === 'super') style.vertAlign = 'superscript';
  return style;
}

/** `rgb(r, g, b)` / hex → `#RRGGBB`; named colors are not supported. */
export function parseCssColor(css: string): string | undefined {
  const rgb = css.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgb !== null) {
    const [, r, g, b] = rgb;
    return `#${[r, g, b].map((part) => Number(part).toString(16).padStart(2, '0').toUpperCase()).join('')}`;
  }
  if (/^#[0-9A-Fa-f]{6}$/.test(css)) return css.toUpperCase();
  return undefined;
}

function firstFontFamily(family: string): string {
  return family.split(',')[0]!.trim().replace(/^['"]|['"]$/g, '');
}
