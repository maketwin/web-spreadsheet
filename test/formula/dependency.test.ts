import { describe, expect, it } from 'vitest';
import { DependencyGraph } from '../../src/formula/dependency';

describe('DependencyGraph', () => {
  it('returns transitive affected cells for A to B to C', () => {
    const graph = new DependencyGraph();
    graph.setDependencies('B1', ['A1']);
    graph.setDependencies('C1', ['B1']);

    expect(graph.getAffected('A1')).toEqual(['B1', 'C1']);
  });

  it('clears dependencies', () => {
    const graph = new DependencyGraph();
    graph.setDependencies('B1', ['A1']);
    graph.clearDependencies('B1');

    expect(graph.getAffected('A1')).toEqual([]);
  });

  it('returns an empty list for an empty graph', () => {
    const graph = new DependencyGraph();

    expect(graph.getAffected('A1')).toEqual([]);
  });
});
