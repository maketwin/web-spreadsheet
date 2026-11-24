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
    return this.placesRing(cellId, dependsOn);
  }

  clearDependencies(cellId: string): void {
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
    this.nextHigh = 0;
    this.nextLow = -1;
    this.stale = false;
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

  getDependencies(cellId: string): readonly string[] {
    return [...(this.reverse.get(cellId) ?? [])];
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
