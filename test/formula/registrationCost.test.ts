import { describe, expect, it } from 'vitest';
import { DependencyGraph } from '../../src/formula/dependency';
import { Store } from '../../src/store/Store';
import { FormulaEngine } from '../../src/formula/FormulaEngine';
import { createFormulaSync } from '../../src/formula/formulaSync';
import { CommandManager, MAX_HISTORY } from '../../src/commands/CommandManager';
import { SetCellText } from '../../src/commands/impl/SetCellText';

const col = (c: number): string => String.fromCharCode(65 + c);

type GraphInternals = { order: Map<string, number>; reverse: Map<string, Set<string>> };
const internals = (graph: DependencyGraph): GraphInternals => graph as unknown as GraphInternals;

/** Every edge between two formulas must run downwards in rank. */
function expectTopological(graph: DependencyGraph): void {
  const { order, reverse } = internals(graph);
  for (const [id, deps] of reverse) {
    for (const dep of deps) {
      if (order.has(dep)) expect(order.get(dep)!, `${dep} → ${id}`).toBeLessThan(order.get(id)!);
    }
  }
}

// Ring detection used to walk the chain above every formula as it
// registered, which made entering a long chain quadratic. The decision is a
// rank comparison now; these pin that it is still the right decision in every
// entry order, and that the ranks stay a topological order of the graph.
describe('DependencyGraph ring detection', () => {
  it('is settled by rank for a chain entered top-down', () => {
    const graph = new DependencyGraph();
    for (let r = 1; r < 1000; r += 1) expect(graph.setDependencies(`${r}`, [`${r - 1}`])).toBe(false);
    expect(graph.wouldCreateCycle('999', ['998'])).toBe(false);
    expectTopological(graph);
  });

  it('detects a ring however the formulas are entered', () => {
    // Bottom-up: each formula registers before its precedent does.
    const graph = new DependencyGraph();
    for (let r = 999; r >= 1; r -= 1) expect(graph.setDependencies(`${r}`, [`${r - 1}`])).toBe(false);
    expectTopological(graph);
    // Closing the ring at the top, opening it, and an outsider reading the chain.
    expect(graph.setDependencies('0', ['999'])).toBe(true);
    expect(graph.setDependencies('0', [])).toBe(false);
    expect(graph.setDependencies('x', ['999'])).toBe(false);
    expect(graph.setDependencies('1', ['x'])).toBe(true); // x → 999 → … → 1

    // Self-reference.
    expect(new DependencyGraph().setDependencies('a', ['a'])).toBe(true);

    // Rings through re-registered cells of a chain (each cell reads the one above).
    const chain = new DependencyGraph();
    for (let r = 1; r <= 9; r += 1) chain.setDependencies(`${r}`, [`${r - 1}`]);
    expect(chain.setDependencies('5', ['9'])).toBe(true); // 9 → 8 → 7 → 6 → 5
    expect(chain.setDependencies('5', ['4'])).toBe(false);
    expect(chain.setDependencies('3', ['7'])).toBe(true); // 7 → 6 → 5 → 4 → 3
    expect(chain.setDependencies('3', ['2'])).toBe(false);
    expectTopological(chain);
  });

  it('does not miss a ring when a plain cell that others read becomes a formula', () => {
    // A3 = A2 is entered while A2 is plain, A2 = A1 while A1 is plain, then A1 = A3: a ring.
    const graph = new DependencyGraph();
    expect(graph.setDependencies('A3', ['A2'])).toBe(false);
    expect(graph.setDependencies('A2', ['A1'])).toBe(false);
    expect(graph.setDependencies('A1', ['A3'])).toBe(true);
    expect(graph.setDependencies('A1', [])).toBe(false);
    expect(graph.setDependencies('B1', ['A3'])).toBe(false);
  });

  it('keeps ranks a topological order in any entry order', () => {
    const graph = new DependencyGraph();
    const add = (id: string, deps: readonly string[]): void => {
      expect(graph.setDependencies(id, [...deps])).toBe(false);
      expectTopological(graph);
    };
    // Bottom-up: c reads b, b reads a — a comes last.
    add('c', ['b']);
    add('b', ['a']);
    add('a', []);
    // b re-registered with a precedent that ranks above it: b is lifted, with c, above it.
    add('z', []);
    add('b', ['a', 'z']);
    add('d', ['c']);
    add('d', ['c', 'a']);
  });

  it('keeps finding rings around an existing one', () => {
    const graph = new DependencyGraph();
    expect(graph.setDependencies('u', ['v'])).toBe(false);
    expect(graph.setDependencies('v', ['u'])).toBe(true);
    expect(graph.setDependencies('w', ['u'])).toBe(false);
    expect(graph.setDependencies('p', ['w'])).toBe(false);
    // p → w → u → p
    expect(graph.setDependencies('u', ['p'])).toBe(true);
    expect(graph.setDependencies('u', ['v'])).toBe(true);
    expect(graph.setDependencies('u', [])).toBe(false);
    expect(graph.setDependencies('w', ['u'])).toBe(false);
    expect(graph.setDependencies('u', ['p'])).toBe(true);
    expect(graph.setDependencies('u', ['v'])).toBe(true);
  });
});

describe('recalculation cost', () => {
  function setup(): { store: Store; engine: FormulaEngine; put: (r: number, c: number, text: string) => void; value: (r: number, c: number) => unknown } {
    const store = new Store();
    const engine = new FormulaEngine(store);
    createFormulaSync(store, engine);
    const put = (r: number, c: number, text: string): void => { store.setCell(r, c, text.startsWith('=') ? { text, formula: text } : { text, value: Number(text) }); };
    return { store, engine, put, value: (r, c) => store.getCell(r, c)?.value };
  }

  it('enters long chains in time linear in their length', () => {
    const { put, value } = setup();
    const started = performance.now();
    // 26 columns x 1000 links: walking the chain above each link needs ~13 million steps.
    for (let r = 1; r <= 1000; r += 1) for (let c = 0; c < 26; c += 1) put(r, c, `=${col(c)}${r}+1`);
    const elapsed = performance.now() - started;
    // The first row is empty, so the chain counts from 0.
    expect(value(1000, 25)).toBe(1000);
    // Generous for CI; it took about two seconds before.
    expect(elapsed).toBeLessThan(1200);
  });

  it('enters a chain bottom-up correctly (each new value recalculates the cells below, as it must)', () => {
    const { put, value } = setup();
    for (let r = 300; r >= 1; r -= 1) put(r, 0, `=A${r}+1`);
    put(0, 0, '5');
    expect(value(300, 0)).toBe(305);
  });

  it('parses a formula once, however often it recalculates', () => {
    const { engine, put, value } = setup();
    put(0, 0, '1');
    put(0, 1, '=A1*2');
    put(0, 2, '=B1*2');
    expect(value(0, 2)).toBe(4);
    // Count what the engine parses from here on.
    let parsed = 0;
    const parser = (engine as unknown as { parser: { parse: (formula: string) => unknown } }).parser;
    const parse = parser.parse.bind(parser);
    parser.parse = (formula: string): unknown => { parsed += 1; return parse(formula); };
    put(0, 0, '3');            // B1 and C1 recalculate
    engine.recalculateAll();   // and once more, all of them
    expect(value(0, 2)).toBe(12);
    expect(parsed).toBe(0);
    put(0, 3, '=C1*2');        // a formula never seen before is parsed, for its registration
    expect(parsed).toBeGreaterThanOrEqual(1);
    expect(value(0, 3)).toBe(24);
  });
});

describe('undo history', () => {
  it('keeps the newest steps only', () => {
    const store = new Store();
    const cm = new CommandManager(store);
    for (let i = 0; i < MAX_HISTORY + 25; i += 1) cm.execute.bind(cm)(new SetCellText({ r: 0, c: 0, text: String(i) }));
    let undone = 0;
    while (cm.canUndo()) { cm.undo(); undone += 1; }
    expect(undone).toBe(MAX_HISTORY);
    // The oldest kept step is #26 of 125; undoing everything lands on the state after #25.
    expect(store.getCell(0, 0)?.text).toBe('24');
  });
});
