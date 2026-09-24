import type { Store } from '../../store/Store';

/**
 * Style id this cell may safely mutate. Import dedup and paste share one id
 * across cells; patching that id would restyle every user of it.
 */
export function styleIdForCell(store: Store, r: number, c: number, sheetId: string, existing: string | undefined): string {
  if (existing !== undefined && !styleUsedElsewhere(store, existing, r, c, sheetId)) return existing;
  const base = existing !== undefined && existing.startsWith('nf-') ? `nf-${r}-${c}` : `cell-${r}-${c}`;
  if (!styleIdTaken(store, base, sheetId)) return base;
  for (let n = 2; n < 10_000; n += 1) {
    const id = `${base}-${n}`;
    if (!styleIdTaken(store, id, sheetId)) return id;
  }
  return `${base}-${Date.now()}`;
}

function styleUsedElsewhere(store: Store, styleId: string, r: number, c: number, sheetId: string): boolean {
  for (const [key, cell] of store.getCells(sheetId)) {
    if (cell.styleId !== styleId) continue;
    const sep = key.indexOf(',');
    if (Number(key.slice(0, sep)) !== r || Number(key.slice(sep + 1)) !== c) return true;
  }
  return false;
}

function styleIdTaken(store: Store, styleId: string, sheetId: string): boolean {
  for (const [, cell] of store.getCells(sheetId)) {
    if (cell.styleId === styleId) return true;
  }
  return false;
}
