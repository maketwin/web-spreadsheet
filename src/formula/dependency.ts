export class DependencyGraph {
  private forward = new Map<string, Set<string>>();
  private reverse = new Map<string, Set<string>>();

  setDependencies(cellId: string, dependsOn: string[]): void {
    this.clearDependencies(cellId);
    this.reverse.set(cellId, new Set(dependsOn));
    for (const dep of dependsOn) {
      let downstream = this.forward.get(dep);
      if (!downstream) {
        downstream = new Set<string>();
        this.forward.set(dep, downstream);
      }
      downstream.add(cellId);
    }
  }

  clearDependencies(cellId: string): void {
    const old = this.reverse.get(cellId);
    if (!old) return;
    for (const dep of old) {
      this.forward.get(dep)?.delete(cellId);
    }
    this.reverse.delete(cellId);
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
   * True when adding `cellId → dependsOn` would create a cycle
   * (self-ref, or cellId is reachable from any dependency via existing edges).
   */
  getDependencies(cellId: string): readonly string[] {
    return [...(this.reverse.get(cellId) ?? [])];
  }

  wouldCreateCycle(cellId: string, dependsOn: readonly string[]): boolean {
    for (const dep of dependsOn) {
      if (dep === cellId) return true;
      // Does `dep` (transitively) already depend on `cellId`?
      if (this.dependsOnTransitively(dep, cellId)) return true;
    }
    return false;
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
