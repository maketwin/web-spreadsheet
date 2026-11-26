import type { Store } from '../../store/Store';
import type { Style } from '../../types';
import { isReservedAxisStyleId } from './SetAxisStyle';

/**
 * Which style ids the cells of a sheet use, with how many cells each. A
 * command that restyles a range captures it once and keeps it current with
 * `reassign` — one sweep of the sheet for the whole range. Asking the store
 * per cell instead costs a sweep per cell (select-all bold: 26,000 sweeps).
 */
export class StyleUsage {
  private readonly users = new Map<string, number>();

  public static capture(store: Store, sheetId: string): StyleUsage {
    const usage = new StyleUsage();
    // Numeric sweep — getCells() would build a "r,c" string per stored cell.
    store.forEachCell((_r, _c, cell) => {
      if (cell.styleId !== undefined) usage.bump(cell.styleId, 1);
    }, sheetId);
    return usage;
  }

  /**
   * Style id this cell may safely mutate. Import dedup and paste share one
   * id across cells; patching that id would restyle every user of it, so an
   * id another cell holds as well is left alone and a fresh one is made.
   * Reserved axis ids (`colstyle-*` / `rowstyle-*`) are never returned to a
   * cell — patching one would restyle the whole row/column.
   */
  public forCell(r: number, c: number, existing: string | undefined): string {
    if (existing !== undefined && !isReservedAxisStyleId(existing) && (this.users.get(existing) ?? 0) <= 1) return existing;
    const base = existing !== undefined && existing.startsWith('nf-') && !isReservedAxisStyleId(existing) ? `nf-${r}-${c}` : `cell-${r}-${c}`;
    if (!this.taken(base)) return base;
    for (let n = 2; n < 10_000; n += 1) {
      const id = `${base}-${n}`;
      if (!this.taken(id)) return id;
    }
    return `${base}-${Date.now()}`;
  }

  /** Cell that used `prev` (if it did) has been given `next` (if it has one). */
  public reassign(prev: string | undefined, next: string | undefined): void {
    if (prev === next) return;
    if (prev !== undefined) this.bump(prev, -1);
    if (next !== undefined) this.bump(next, 1);
  }

  private taken(styleId: string): boolean {
    return (this.users.get(styleId) ?? 0) > 0;
  }

  private bump(styleId: string, delta: number): void {
    const count = (this.users.get(styleId) ?? 0) + delta;
    if (count <= 0) this.users.delete(styleId);
    else this.users.set(styleId, count);
  }
}

/** {@link StyleUsage.forCell} for a single cell; commands covering a range share one capture instead. */
export function styleIdForCell(store: Store, r: number, c: number, sheetId: string, existing: string | undefined): string {
  return StyleUsage.capture(store, sheetId).forCell(r, c, existing);
}

/**
 * Interner for styles materialized on copy: a cell whose style comes from the
 * row/column default has no styleId of its own, but the clipboard must carry
 * the effective format (Excel copies what is displayed). Identical contents
 * share one fresh id — never a reserved axis id, and never an id already in
 * use. The style entry is registered immediately: a paste on the same sheet
 * applies the id without re-registering its content.
 */
export function makeCopyStyleInterner(store: Store, sheetId = store.getActiveSheetId()): (style: Style) => string {
  const byContent = new Map<string, string>();
  let seq = 0;
  return (style: Style): string => {
    const key = JSON.stringify(style);
    const known = byContent.get(key);
    if (known !== undefined) return known;
    let id = '';
    do {
      seq += 1;
      id = `copied-style-${seq}`;
    } while (isReservedAxisStyleId(id) || store.getStyle(id, sheetId) !== undefined);
    store.setStyle(id, style, sheetId);
    byContent.set(key, id);
    return id;
  };
}
