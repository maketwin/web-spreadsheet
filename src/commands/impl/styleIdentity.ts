import type { Store } from '../../store/Store';

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
    for (const [, cell] of store.getCells(sheetId)) {
      if (cell.styleId !== undefined) usage.bump(cell.styleId, 1);
    }
    return usage;
  }

  /**
   * Style id this cell may safely mutate. Import dedup and paste share one
   * id across cells; patching that id would restyle every user of it, so an
   * id another cell holds as well is left alone and a fresh one is made.
   */
  public forCell(r: number, c: number, existing: string | undefined): string {
    if (existing !== undefined && (this.users.get(existing) ?? 0) <= 1) return existing;
    const base = existing !== undefined && existing.startsWith('nf-') ? `nf-${r}-${c}` : `cell-${r}-${c}`;
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
