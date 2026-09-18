import type { Store } from '../store/Store';

/**
 * Parse the internal range key "r,c:r,c" used by chart and sparkline specs.
 * Normalizes reversed endpoints like the A1 parser does.
 */
export function parseInternalRangeKey(range: string): { r1: number; c1: number; r2: number; c2: number } {
  const parts = range.split(':');
  const start = parts[0]?.split(',').map(Number) ?? [0, 0];
  const end = parts[1]?.split(',').map(Number) ?? start;
  const r1 = start[0] ?? 0;
  const c1 = start[1] ?? 0;
  const r2 = end[0] ?? r1;
  const c2 = end[1] ?? c1;
  return { r1: Math.min(r1, r2), c1: Math.min(c1, c2), r2: Math.max(r1, r2), c2: Math.max(c1, c2) };
}

/**
 * The numeric series a sparkline draws. Non-numeric and empty cells are
 * skipped (Excel leaves gaps instead of plotting zeros for blanks).
 */
export function sparklineValues(store: Store, range: string): number[] {
  const { r1, c1, r2, c2 } = parseInternalRangeKey(range);
  const values: number[] = [];
  for (let r = r1; r <= r2; r += 1) {
    for (let c = c1; c <= c2; c += 1) {
      const cell = store.getCell(r, c);
      if (cell === undefined) continue;
      if (typeof cell.value === 'number') { values.push(cell.value); continue; }
      const text = cell.text?.trim();
      if (text !== undefined && text !== '') {
        const parsed = Number(text);
        if (Number.isFinite(parsed)) values.push(parsed);
      }
    }
  }
  return values;
}
