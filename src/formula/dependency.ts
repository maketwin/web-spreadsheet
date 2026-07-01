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
}
