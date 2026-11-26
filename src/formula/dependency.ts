import { cellIdCoords } from '../util/cell';
import { TOTAL_COLS, TOTAL_ROWS } from '../util/gridSize';

/** Rows per rectangle-index bucket (256). */
const RECT_BUCKET_ROW_SHIFT = 8;
/** Columns per rectangle-index bucket (64). */
const RECT_BUCKET_COL_SHIFT = 6;
const RECT_COL_BUCKETS = TOTAL_COLS >> RECT_BUCKET_COL_SHIFT;
const RECT_ROW_BUCKETS = TOTAL_ROWS >> RECT_BUCKET_ROW_SHIFT;
/** A rectangle overlapping more buckets than this goes on the sheet's wide list. */
const MAX_RECT_BUCKETS = 64;

/** A rectangle dependency registered by one formula. */
interface RectEntry {
  readonly owner: string;
  readonly r1: number;
  readonly c1: number;
  readonly r2: number;
  readonly c2: number;
}

interface SheetRects {
  readonly buckets: Map<number, RectEntry[]>;
  /** Rectangles too vast to bucket (whole columns) — scanned per query; rare. */
  readonly wide: RectEntry[];
}

/** What one formula registered, so unregistering puts it all back. */
interface OwnerRect {
  readonly sheetId: string;
  readonly entry: RectEntry;
  /** Bucket indices when bucketed; null on the wide list. */
  readonly buckets: readonly number[] | null;
}

/** Where a registered formula lives (position index, for rectangle queries). */
interface FormulaPos {
  readonly sheetId: string;
  readonly r: number;
  readonly c: number;
  readonly bucket: number;
}

function rectBucketOf(r: number, c: number): number {
  return (r >> RECT_BUCKET_ROW_SHIFT) * RECT_COL_BUCKETS + (c >> RECT_BUCKET_COL_SHIFT);
}

function contains(entry: RectEntry, r: number, c: number): boolean {
  return entry.r1 <= r && r <= entry.r2 && entry.c1 <= c && c <= entry.c2;
}

/** `"sheetId:r,c"` → position; null for the unscoped ids plain graph tests use. */
function scopedPos(scopedId: string): FormulaPos | null {
  const colon = scopedId.indexOf(':');
  if (colon <= 0) return null;
  const coords = cellIdCoords(scopedId.slice(colon + 1));
  if (coords === null) return null;
  return { sheetId: scopedId.slice(0, colon), r: coords.r, c: coords.c, bucket: rectBucketOf(coords.r, coords.c) };
}

export interface RectRegistration {
  readonly sheetId: string;
  readonly r1: number;
  readonly c1: number;
  readonly r2: number;
  readonly c2: number;
}

export class DependencyGraph {
  private forward = new Map<string, Set<string>>();
  private reverse = new Map<string, Set<string>>();
  /**
   * Topological rank of every registered formula: along any chain of
   * precedents that is free of rings, ranks only go down. Whether new
   * precedents close a ring is then a comparison — a ring would need a path
   * back up to the formula — instead of a walk of the chain above it, which
   * made entering a long chain quadratic.
   */
  private order = new Map<string, number>();
  private nextHigh = 0;
  private nextLow = -1;
  /**
   * Formulas on a ring, or depending on one. Their ranks mean nothing:
   * a check that involves one of them always walks.
   */
  private readonly tainted = new Set<string>();
  /** The tainted formulas that are on a ring themselves (the rest only depend on one). */
  private readonly ringMembers = new Set<string>();
  /** A ring appeared, or may have opened, since the ranks were last rebuilt. */
  private stale = false;
  /**
   * Registered formulas by bucket, per sheet: lets a rectangle dependency
   * enumerate the formula cells inside it, so those get exact per-cell edges
   * and ring detection, lifting and the queue order work unchanged.
   */
  private readonly positions = new Map<string, Map<number, Set<string>>>();
  private readonly ownerPos = new Map<string, FormulaPos>();
  /**
   * Rectangle dependencies (a range too large for per-cell edges), bucketed
   * per sheet; a cell change looks up its one bucket plus the wide list.
   */
  private readonly rects = new Map<string, SheetRects>();
  private readonly ownerRects = new Map<string, OwnerRect[]>();

  /**
   * Install `cellId`'s precedents. Returns true when they close a ring
   * (the edges are installed either way; the caller shows the ring as 0).
   */
  setDependencies(cellId: string, dependsOn: string[]): boolean {
    // A formula that registers again keeps its rank: its edges change, its
    // place in the order usually does not.
    const previous = this.order.get(cellId);
    this.clearDependencies(cellId);
    if (previous !== undefined) this.order.set(cellId, previous);
    this.reverse.set(cellId, new Set(dependsOn));
    for (const dep of dependsOn) {
      let downstream = this.forward.get(dep);
      if (!downstream) {
        downstream = new Set<string>();
        this.forward.set(dep, downstream);
      }
      downstream.add(cellId);
    }
    this.indexPosition(cellId);
    return this.placesRing(cellId, dependsOn);
  }

  clearDependencies(cellId: string): void {
    this.clearRects(cellId);
    this.clearPosition(cellId);
    const old = this.reverse.get(cellId);
    if (!old) return;
    for (const dep of old) {
      this.forward.get(dep)?.delete(cellId);
    }
    this.reverse.delete(cellId);
    this.order.delete(cellId);
    // It may have been what held a ring together.
    if (this.ringMembers.delete(cellId)) this.stale = true;
    this.tainted.delete(cellId);
  }

  clear(): void {
    this.forward.clear();
    this.reverse.clear();
    this.order.clear();
    this.tainted.clear();
    this.ringMembers.clear();
    this.positions.clear();
    this.ownerPos.clear();
    this.rects.clear();
    this.ownerRects.clear();
    this.nextHigh = 0;
    this.nextLow = -1;
    this.stale = false;
  }

  /**
   * A sheet was deleted: its rectangle registrations and position index go
   * with it (its formulas unregister one by one, which also cleans up —
   * this clears what a wholesale sheet drop would otherwise leave behind).
   */
  clearSheetRects(sheetId: string): void {
    this.rects.delete(sheetId);
    this.positions.delete(sheetId);
  }

  /**
   * Register `ownerId`'s rectangle dependencies (ranges above
   * RANGE_DEP_CELLS, sheet-resolved). Rectangles overlapping at most
   * {@link MAX_RECT_BUCKETS} buckets are indexed per bucket; vaster ones
   * (whole columns) go on the sheet's wide list, scanned per query.
   */
  registerRects(ownerId: string, rects: readonly RectRegistration[]): void {
    this.clearRects(ownerId);
    if (rects.length === 0) return;
    const records: OwnerRect[] = [];
    for (const rect of rects) {
      const rb1 = rect.r1 >> RECT_BUCKET_ROW_SHIFT;
      const rb2 = rect.r2 >> RECT_BUCKET_ROW_SHIFT;
      const cb1 = rect.c1 >> RECT_BUCKET_COL_SHIFT;
      const cb2 = rect.c2 >> RECT_BUCKET_COL_SHIFT;
      const entry: RectEntry = { owner: ownerId, r1: rect.r1, c1: rect.c1, r2: rect.r2, c2: rect.c2 };
      let sheet = this.rects.get(rect.sheetId);
      if (sheet === undefined) {
        sheet = { buckets: new Map(), wide: [] };
        this.rects.set(rect.sheetId, sheet);
      }
      if ((rb2 - rb1 + 1) * (cb2 - cb1 + 1) > MAX_RECT_BUCKETS) {
        sheet.wide.push(entry);
        records.push({ sheetId: rect.sheetId, entry, buckets: null });
        continue;
      }
      const buckets: number[] = [];
      for (let rb = rb1; rb <= rb2; rb += 1) {
        for (let cb = cb1; cb <= cb2; cb += 1) {
          const idx = rb * RECT_COL_BUCKETS + cb;
          let list = sheet.buckets.get(idx);
          if (list === undefined) {
            list = [];
            sheet.buckets.set(idx, list);
          }
          list.push(entry);
          buckets.push(idx);
        }
      }
      records.push({ sheetId: rect.sheetId, entry, buckets });
    }
    this.ownerRects.set(ownerId, records);
  }

  /** Owners of registered rectangles on `sheetId` that contain (r, c) — the readers a change there must wake. */
  rectDependents(sheetId: string, r: number, c: number): string[] {
    const sheet = this.rects.get(sheetId);
    if (sheet === undefined) return [];
    const result = new Set<string>();
    const list = sheet.buckets.get(rectBucketOf(r, c));
    if (list !== undefined) {
      for (const entry of list) {
        if (contains(entry, r, c)) result.add(entry.owner);
      }
    }
    for (const entry of sheet.wide) {
      if (contains(entry, r, c)) result.add(entry.owner);
    }
    return [...result];
  }

  /** Owners of registered rectangles on `sheetId` reaching at/after `start`
   * along `axis` — the readers a structural move of that half-plane wakes. */
  rectDependentsFrom(sheetId: string, axis: 'row' | 'col', start: number): string[] {
    const sheet = this.rects.get(sheetId);
    if (sheet === undefined) return [];
    const result = new Set<string>();
    const reaches = (entry: RectEntry): boolean => (axis === 'row' ? entry.r2 : entry.c2) >= start;
    for (const list of sheet.buckets.values()) {
      for (const entry of list) {
        if (reaches(entry)) result.add(entry.owner);
      }
    }
    for (const entry of sheet.wide) {
      if (reaches(entry)) result.add(entry.owner);
    }
    return [...result];
  }

  /** Owners of registered rectangles on `sheetId` that intersect `rect` —
   * the readers a wholesale rewrite of that rectangle wakes. */
  rectDependentsIn(sheetId: string, rect: { r1: number; c1: number; r2: number; c2: number }): string[] {
    const sheet = this.rects.get(sheetId);
    if (sheet === undefined) return [];
    const result = new Set<string>();
    const hits = (entry: RectEntry): boolean => entry.r1 <= rect.r2 && entry.r2 >= rect.r1 && entry.c1 <= rect.c2 && entry.c2 >= rect.c1;
    const rb1 = Math.max(0, rect.r1 >> RECT_BUCKET_ROW_SHIFT);
    const rb2 = Math.min(RECT_ROW_BUCKETS - 1, rect.r2 >> RECT_BUCKET_ROW_SHIFT);
    const cb1 = Math.max(0, rect.c1 >> RECT_BUCKET_COL_SHIFT);
    const cb2 = Math.min(RECT_COL_BUCKETS - 1, rect.c2 >> RECT_BUCKET_COL_SHIFT);
    // A rectangle spanning more buckets than the sheet indexes is cheaper
    // answered by one sweep of the bucket map than by visiting each bucket.
    if ((rb2 - rb1 + 1) * (cb2 - cb1 + 1) > sheet.buckets.size) {
      for (const list of sheet.buckets.values()) {
        for (const entry of list) {
          if (hits(entry)) result.add(entry.owner);
        }
      }
    } else {
      for (let rb = rb1; rb <= rb2; rb += 1) {
        for (let cb = cb1; cb <= cb2; cb += 1) {
          const list = sheet.buckets.get(rb * RECT_COL_BUCKETS + cb);
          if (list === undefined) continue;
          for (const entry of list) {
            if (hits(entry)) result.add(entry.owner);
          }
        }
      }
    }
    for (const entry of sheet.wide) {
      if (hits(entry)) result.add(entry.owner);
    }
    return [...result];
  }

  /** Formula cells registered inside the rectangle — the per-cell edges that keep ring detection exact. */
  formulasInRect(sheetId: string, r1: number, c1: number, r2: number, c2: number): string[] {
    const sheetPositions = this.positions.get(sheetId);
    if (sheetPositions === undefined) return [];
    const rb1 = Math.max(0, r1 >> RECT_BUCKET_ROW_SHIFT);
    const rb2 = Math.min(RECT_ROW_BUCKETS - 1, r2 >> RECT_BUCKET_ROW_SHIFT);
    const cb1 = Math.max(0, c1 >> RECT_BUCKET_COL_SHIFT);
    const cb2 = Math.min(RECT_COL_BUCKETS - 1, c2 >> RECT_BUCKET_COL_SHIFT);
    const result = new Set<string>();
    for (let rb = rb1; rb <= rb2; rb += 1) {
      for (let cb = cb1; cb <= cb2; cb += 1) {
        const bucket = sheetPositions.get(rb * RECT_COL_BUCKETS + cb);
        if (bucket === undefined) continue;
        for (const id of bucket) {
          const pos = this.ownerPos.get(id);
          if (pos === undefined) continue;
          if (pos.r < r1 || pos.r > r2 || pos.c < c1 || pos.c > c2) continue;
          result.add(id);
        }
      }
    }
    return [...result];
  }

  private indexPosition(scopedId: string): void {
    this.clearPosition(scopedId);
    const pos = scopedPos(scopedId);
    if (pos === null) return;
    let sheet = this.positions.get(pos.sheetId);
    if (sheet === undefined) {
      sheet = new Map();
      this.positions.set(pos.sheetId, sheet);
    }
    let bucket = sheet.get(pos.bucket);
    if (bucket === undefined) {
      bucket = new Set();
      sheet.set(pos.bucket, bucket);
    }
    bucket.add(scopedId);
    this.ownerPos.set(scopedId, pos);
  }

  private clearPosition(scopedId: string): void {
    const pos = this.ownerPos.get(scopedId);
    if (pos === undefined) return;
    this.ownerPos.delete(scopedId);
    const bucket = this.positions.get(pos.sheetId)?.get(pos.bucket);
    if (bucket === undefined) return;
    bucket.delete(scopedId);
    if (bucket.size === 0) this.positions.get(pos.sheetId)!.delete(pos.bucket);
  }

  private clearRects(ownerId: string): void {
    const records = this.ownerRects.get(ownerId);
    if (records === undefined) return;
    this.ownerRects.delete(ownerId);
    for (const record of records) {
      const sheet = this.rects.get(record.sheetId);
      if (sheet === undefined) continue;
      if (record.buckets === null) {
        const at = sheet.wide.indexOf(record.entry);
        if (at >= 0) sheet.wide.splice(at, 1);
      } else {
        for (const idx of record.buckets) {
          const list = sheet.buckets.get(idx);
          if (list === undefined) continue;
          const at = list.indexOf(record.entry);
          if (at >= 0) list.splice(at, 1);
          if (list.length === 0) sheet.buckets.delete(idx);
        }
      }
      if (sheet.buckets.size === 0 && sheet.wide.length === 0) this.rects.delete(record.sheetId);
    }
  }

  /** Cells that read `cellId` directly (one edge away). */
  directDependents(cellId: string): Iterable<string> {
    return this.forward.get(cellId) ?? [];
  }

  getAffected(changedCellId: string): string[] {
    const result = new Set<string>();
    const queue = [changedCellId];
    while (queue.length) {
      const cur = queue.shift();
      if (cur === undefined) break;
      const downstream = this.forward.get(cur);
      if (!downstream) continue;
      for (const cellId of downstream) {
        if (!result.has(cellId)) {
          result.add(cellId);
          queue.push(cellId);
        }
      }
    }
    return [...result];
  }

  /**
   * One incremental precedent edge `cellId` reads `dep`, without rebuilding
   * `cellId`'s dependency set — the rectangle registrations, position index
   * and the rest of its edges stay untouched (what registering a formula
   * inside someone's rectangle does to the rectangle's owner). Returns true
   * when this edge closes a ring.
   */
  addDependency(cellId: string, dep: string): boolean {
    const deps = this.reverse.get(cellId);
    if (deps === undefined) {
      this.reverse.set(cellId, new Set([dep]));
    } else if (!deps.has(dep)) {
      deps.add(dep);
    } else {
      return false; // edge already installed
    }
    let downstream = this.forward.get(dep);
    if (!downstream) {
      downstream = new Set();
      this.forward.set(dep, downstream);
    }
    downstream.add(cellId);
    return this.placesRing(cellId, [dep]);
  }

  getDependencies(cellId: string): readonly string[] {
    return [...(this.reverse.get(cellId) ?? [])];
  }

  /** The live precedent set without copying it (hot paths: queue ordering). */
  dependenciesOf(cellId: string): ReadonlySet<string> | undefined {
    return this.reverse.get(cellId);
  }

  /**
   * True when adding `cellId → dependsOn` would create a cycle
   * (self-ref, or cellId is reachable from any dependency via existing edges).
   * Always walks; {@link setDependencies} answers the same question for an
   * installation without walking in the common case.
   */
  wouldCreateCycle(cellId: string, dependsOn: readonly string[]): boolean {
    for (const dep of dependsOn) {
      if (dep === cellId) return true;
      // Does `dep` (transitively) already depend on `cellId`?
      if (this.dependsOnTransitively(dep, cellId)) return true;
    }
    return false;
  }

  /**
   * Rank `cellId` against its new precedents and tell whether they close a
   * ring. With every rank reliable, a formula that ranks above all of its
   * precedents cannot close one and nothing is walked; the ranks are reliable
   * exactly when neither the formula nor a precedent is tainted.
   */
  private placesRing(cellId: string, dependsOn: readonly string[]): boolean {
    if (this.stale) this.reorder();
    let rank = this.order.get(cellId);
    if (rank === undefined) {
      // First registration. The cell may have been read as a plain cell
      // already: rank it below every formula that does, and the order holds
      // for their edges without touching them.
      const read = [...(this.forward.get(cellId) ?? [])].some((dependent) => this.reverse.has(dependent));
      if (read) {
        rank = this.nextLow;
        this.nextLow -= 1;
      } else {
        rank = this.nextHigh;
        this.nextHigh += 1;
      }
      this.order.set(cellId, rank);
    }
    // Behind a ring itself, or reading something that is: walk. The taint
    // spreads along edges, so every formula outside it reads only formulas
    // outside it, and their ranks are all consistent.
    const wasBehindRing = this.tainted.has(cellId);
    const behindRing = wasBehindRing || dependsOn.some((dep) => this.tainted.has(dep));
    if (behindRing) {
      this.tainted.add(cellId);
      // A formula that just started reading behind a ring takes its readers with it.
      if (!wasBehindRing) for (const dependent of this.getAffected(cellId)) this.tainted.add(dependent);
    }
    if (!behindRing) {
      // A precedent without a rank is not a formula: it has no edges and cannot be on a ring.
      if (!dependsOn.some((dep) => (this.order.get(dep) ?? Number.NEGATIVE_INFINITY) >= rank)) return false;
    }
    if (dependsOn.some((dep) => this.dependsOnTransitively(dep, cellId))) {
      this.stale = true;
      return true;
    }
    // On no ring with these edges: if it was on one, that ring may have opened.
    if (this.ringMembers.delete(cellId)) this.stale = true;
    this.lift(cellId);
    return false;
  }

  /**
   * Re-rank `cellId` and everything that depends on it, in dependency order,
   * above every existing rank. All of their other precedents keep their
   * (lower) ranks, so the order holds for every edge afterwards. Tainted
   * formulas in the closure keep their (meaningless) rank and their taint.
   */
  private lift(cellId: string): void {
    const closure = new Set<string>([cellId]);
    const queue = [cellId];
    while (queue.length > 0) {
      const cur = queue.pop();
      if (cur === undefined) break;
      for (const dependent of this.forward.get(cur) ?? []) {
        // Only formulas hold edges; a stale forward entry is not one.
        if (!closure.has(dependent) && this.reverse.has(dependent)) {
          closure.add(dependent);
          queue.push(dependent);
        }
      }
    }
    const pending = new Map<string, number>();
    for (const id of closure) {
      let inside = 0;
      for (const dep of this.reverse.get(id) ?? []) if (closure.has(dep)) inside += 1;
      pending.set(id, inside);
    }
    const ready = [...closure].filter((id) => pending.get(id) === 0);
    while (ready.length > 0) {
      const id = ready.pop();
      if (id === undefined) break;
      pending.delete(id);
      this.order.set(id, this.nextHigh);
      this.nextHigh += 1;
      for (const dependent of this.forward.get(id) ?? []) {
        if (!closure.has(dependent)) continue;
        const left = (pending.get(dependent) ?? 0) - 1;
        pending.set(dependent, left);
        if (left === 0) ready.push(dependent);
      }
    }
  }

  /**
   * Rebuild every rank from scratch (a ring appeared or may have opened).
   * Formulas free of rings get consistent ranks in a full topological pass;
   * the rest — on a ring, or depending on one — never come up in that pass
   * and are tainted, which keeps every later check that involves them a walk.
   * Peeling the tainted ones from the bottom leaves exactly the formulas
   * that are on a ring themselves.
   */
  private reorder(): void {
    this.stale = false;
    this.tainted.clear();
    this.ringMembers.clear();
    const waiting = new Map<string, number>();
    for (const [id, deps] of this.reverse) {
      let formulas = 0;
      for (const dep of deps) if (this.reverse.has(dep)) formulas += 1;
      waiting.set(id, formulas);
    }
    const ready = [...waiting.keys()].filter((id) => waiting.get(id) === 0);
    let rank = 0;
    while (ready.length > 0) {
      const id = ready.pop();
      if (id === undefined) break;
      waiting.delete(id);
      this.order.set(id, rank);
      rank += 1;
      for (const dependent of this.forward.get(id) ?? []) {
        if (!waiting.has(dependent)) continue;
        const left = (waiting.get(dependent) ?? 0) - 1;
        waiting.set(dependent, left);
        if (left === 0) ready.push(dependent);
      }
    }
    for (const id of waiting.keys()) {
      this.tainted.add(id);
      this.order.set(id, this.nextLow);
      this.nextLow -= 1;
    }
    // Peel the tainted formulas from the bottom (nothing tainted reads them):
    // what never comes off lies on a cycle.
    const readersLeft = new Map<string, number>();
    for (const id of waiting.keys()) {
      let readers = 0;
      for (const dependent of this.forward.get(id) ?? []) if (waiting.has(dependent)) readers += 1;
      readersLeft.set(id, readers);
    }
    const bottom = [...waiting.keys()].filter((id) => readersLeft.get(id) === 0);
    while (bottom.length > 0) {
      const id = bottom.pop();
      if (id === undefined) break;
      waiting.delete(id);
      for (const dep of this.reverse.get(id) ?? []) {
        if (!waiting.has(dep)) continue;
        const left = (readersLeft.get(dep) ?? 0) - 1;
        readersLeft.set(dep, left);
        if (left === 0) bottom.push(dep);
      }
    }
    for (const id of waiting.keys()) this.ringMembers.add(id);
    this.nextHigh = rank;
  }

  /** Walk reverse edges: does `from` eventually depend on `target`? */
  private dependsOnTransitively(from: string, target: string): boolean {
    const seen = new Set<string>();
    const queue = [from];
    while (queue.length > 0) {
      const cur = queue.shift();
      if (cur === undefined) break;
      if (cur === target) return true;
      if (seen.has(cur)) continue;
      seen.add(cur);
      const deps = this.reverse.get(cur);
      if (deps === undefined) continue;
      for (const id of deps) queue.push(id);
    }
    return false;
  }
}
