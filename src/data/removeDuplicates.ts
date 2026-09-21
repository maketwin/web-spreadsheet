/** Excel-style Remove Duplicates helpers (pure). */

export interface RemoveDuplicatesRange {
  readonly r1: number;
  readonly c1: number;
  readonly r2: number;
  readonly c2: number;
}

/**
 * Rows (absolute indices) to delete, bottom-ready order not required —
 * caller should delete from high index to low.
 * Keeps the first occurrence; compares selected columns only.
 * Header row (when hasHeader) is never deleted.
 */
export function findDuplicateRows(
  rowKeys: readonly (readonly string[])[],
  opts: { readonly hasHeader: boolean },
): number[] {
  const start = opts.hasHeader ? 1 : 0;
  const seen = new Set<string>();
  const dupRel: number[] = [];
  for (let i = start; i < rowKeys.length; i += 1) {
    const key = rowKeys[i]!.map((v) => v.toLowerCase()).join('\u0001');
    if (seen.has(key)) dupRel.push(i);
    else seen.add(key);
  }
  return dupRel;
}

/** Build per-row key cells for columns `colIndexes` (0-based within the range). */
export function buildRowKeys(
  getText: (r: number, c: number) => string,
  range: RemoveDuplicatesRange,
  colIndexes: readonly number[],
): string[][] {
  const rows: string[][] = [];
  for (let r = range.r1; r <= range.r2; r += 1) {
    rows.push(colIndexes.map((ci) => getText(r, range.c1 + ci)));
  }
  return rows;
}
