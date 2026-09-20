import { describe, expect, it } from 'vitest';
import { Store } from '../../src/store/Store';
import { FormulaEngine } from '../../src/formula/FormulaEngine';
import { DependencyGraph } from '../../src/formula/dependency';

describe('circular references', () => {
  it('DependencyGraph.wouldCreateCycle detects self and mutual cycles', () => {
    const g = new DependencyGraph();
    expect(g.wouldCreateCycle('0,0', ['0,0'])).toBe(true);
    g.setDependencies('0,1', ['0,0']);
    expect(g.wouldCreateCycle('0,0', ['0,1'])).toBe(true);
    expect(g.wouldCreateCycle('0,2', ['0,0'])).toBe(false);
  });

  it('FormulaEngine yields 0 for a self-referential formula (Excel iteration off)', () => {
    const store = new Store();
    const engine = new FormulaEngine(store);
    engine.setFormula('0,0', '=A1+1', ['0,0']);
    expect(store.getCell(0, 0)?.value).toBe(0);
  });

  it('mutual A1↔B1 settles to 0 without hanging', () => {
    const store = new Store();
    const engine = new FormulaEngine(store);
    engine.setFormula('0,0', '=B1', ['0,1']);
    engine.setFormula('0,1', '=A1', ['0,0']);
    expect(store.getCell(0, 0)?.value).toBe(0);
    expect(store.getCell(0, 1)?.value).toBe(0);
  });
});
