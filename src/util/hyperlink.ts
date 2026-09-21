import type { Store } from '../store/Store';
import type { CellHyperlink } from '../types';
import { parseRange } from './cell';

export type HyperlinkOpenResult =
  | { readonly kind: 'external'; readonly url: string }
  | { readonly kind: 'sheet'; readonly sheetId?: string; readonly r: number; readonly c: number }
  | { readonly kind: 'invalid' };

/** Classify a hyperlink target for open / navigate. */
export function resolveHyperlinkTarget(store: Store, link: CellHyperlink): HyperlinkOpenResult {
  const raw = link.target.trim();
  if (raw === '') return { kind: 'invalid' };
  const lower = raw.toLowerCase();
  if (lower.startsWith('http://') || lower.startsWith('https://') || lower.startsWith('mailto:')) {
    return { kind: 'external', url: raw };
  }
  // Strip leading # (Excel internal)
  const ref = raw.startsWith('#') ? raw.slice(1) : raw;
  const bang = ref.lastIndexOf('!');
  let sheetName: string | undefined;
  let a1 = ref;
  if (bang >= 0) {
    sheetName = ref.slice(0, bang).replace(/^'|'$/g, '');
    a1 = ref.slice(bang + 1);
  }
  // Single cell only (A1 or $A$1)
  const m = /^\$?([A-Za-z]+)\$?(\d+)$/.exec(a1.trim());
  if (m === null) {
    // treat unknown as external-ish file path — open as URL if looks like www.
    if (lower.startsWith('www.')) return { kind: 'external', url: `https://${raw}` };
    return { kind: 'invalid' };
  }
  try {
    const addr = parseRange(`${m[1]}${m[2]}`);
    let sheetId: string | undefined;
    if (sheetName !== undefined && sheetName !== '') {
      const sheet = store.getSheets().find((s) => s.name.toLowerCase() === sheetName!.toLowerCase());
      if (sheet === undefined) return { kind: 'invalid' };
      sheetId = sheet.id;
    }
    return { kind: 'sheet', ...(sheetId !== undefined ? { sheetId } : {}), r: addr.r1, c: addr.c1 };
  } catch {
    return { kind: 'invalid' };
  }
}

export function openHyperlink(store: Store, link: CellHyperlink, navigate?: (r: number, c: number, sheetId?: string) => void): boolean {
  const resolved = resolveHyperlinkTarget(store, link);
  if (resolved.kind === 'external') {
    if (typeof window !== 'undefined') window.open(resolved.url, '_blank', 'noopener,noreferrer');
    return true;
  }
  if (resolved.kind === 'sheet') {
    navigate?.(resolved.r, resolved.c, resolved.sheetId);
    return true;
  }
  return false;
}

/** Excel default hyperlink paint color. */
export const HYPERLINK_COLOR = '#0563C1';
