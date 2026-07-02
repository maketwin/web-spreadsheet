import type { Store } from '../store/Store';

/** Service for filtering and sorting sheet data. */
export class FilterService {
  public constructor(private readonly store: Store) {}

  /** Get unique values in a column within a range. */
  public getFilterValues(r1: number, c: number, r2: number): string[] {
    const seen = new Set<string>();
    for (let r = r1; r <= r2; r += 1) {
      const cell = this.store.getCell(r, c);
      const text = cell?.text ?? '';
      if (text !== '') seen.add(text);
    }
    return [...seen].sort();
  }

  /** Hide rows where column `c` value is not in `allowedValues`. */
  public filterColumn(r1: number, c: number, r2: number, allowedValues: readonly string[]): void {
    const allowed = new Set(allowedValues);
    for (let r = r1; r <= r2; r += 1) {
      const cell = this.store.getCell(r, c);
      const text = cell?.text ?? '';
      const shouldHide = text !== '' && !allowed.has(text);
      const meta = this.store.getRow(r);
      this.store.setRow(r, { ...meta, hide: shouldHide });
    }
  }

  /** Clear all row hide flags in range. */
  public clearFilter(r1: number, r2: number): void {
    for (let r = r1; r <= r2; r += 1) {
      const meta = this.store.getRow(r);
      if (meta?.hide === true) {
        this.store.setRow(r, { ...meta, hide: false });
      }
    }
  }

  /** Sort rows in range by column `sortCol` ascending or descending. */
  public sortRange(r1: number, c1: number, r2: number, c2: number, sortCol: number, direction: 'asc' | 'desc'): void {
    const rows: { readonly index: number; readonly cells: readonly CellRow[] }[] = [];
    for (let r = r1; r <= r2; r += 1) {
      const cells: CellRow[] = [];
      for (let c = c1; c <= c2; c += 1) {
        const cell = this.store.getCell(r, c);
        cells.push(cell !== undefined ? { ...cell } : undefined);
      }
      rows.push({ index: r, cells });
    }

    const dir = direction === 'asc' ? 1 : -1;
    const colOffset = sortCol - c1;
    rows.sort((a, b) => {
      const av = a.cells[colOffset]?.text ?? '';
      const bv = b.cells[colOffset]?.text ?? '';
      const an = Number(av);
      const bn = Number(bv);
      if (!Number.isNaN(an) && !Number.isNaN(bn)) return dir * (an - bn);
      return dir * av.localeCompare(bv);
    });

    for (let i = 0; i < rows.length; i += 1) {
      const targetRow = r1 + i;
      for (let c = c1; c <= c2; c += 1) {
        const cellData = rows[i]?.cells[c - c1];
        this.store.setCell(targetRow, c, cellData);
      }
    }
  }
}

type CellRow = import('../types').Cell | undefined;
