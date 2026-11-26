import { describe, expect, it } from 'vitest';
import { evaluate } from '../../src/formula/evaluator';
import { FormulaEngine } from '../../src/formula/FormulaEngine';
import { FormulaParser } from '../../src/formula/parser';
import { FunctionRegistry, registry, type FunctionSpec } from '../../src/formula/registry';
import { createFormulaSync } from '../../src/formula/formulaSync';
import { installApiFunctions } from '../../src/platform/apiFunctions';
import { MockHub } from '../../src/platform/MockHub';
import type { ApiInterface, MockProject } from '../../src/platform/types';
import { Store } from '../../src/store/Store';

// FunctionContext: a ctx-aware function learns which cell and sheet the
// calling formula lives in. The engine path always supplies both; a bare
// evaluate() call (conditional-format / validation rules) hands undefined,
// and only functions that declare the parameter have to care.

const WHERE: FunctionSpec = {
  minArgs: 0,
  maxArgs: 0,
  evaluate: (_args, ctx) => (ctx === undefined ? 'no-ctx' : `${ctx.sheetId}:${ctx.cell.r},${ctx.cell.c}`),
};

function engineWith(table: FunctionRegistry): { store: Store; engine: FormulaEngine } {
  const store = new Store();
  const engine = new FormulaEngine(store, { registry: table });
  createFormulaSync(store, engine);
  return { store, engine };
}

describe('function context', () => {
  it('tells a function which cell holds the formula', () => {
    const table = new FunctionRegistry(registry);
    table.register('WHERE', WHERE);
    const { store } = engineWith(table);
    // B3: 0-based r=1, c=1.
    store.setCell(1, 1, { text: '=WHERE()', formula: '=WHERE()' });
    expect(store.getCell(1, 1)?.value).toBe('sheet-1:1,1');
  });

  it('sheetId follows the sheet the formula lives on', () => {
    const table = new FunctionRegistry(registry);
    table.register('WHERE', WHERE);
    const { store } = engineWith(table);
    const sid = store.addSheet();
    store.setCell(1, 1, { text: '=WHERE()', formula: '=WHERE()' }, sid);
    expect(store.getCell(1, 1, sid)?.value).toBe(`${sid}:1,1`);
  });

  it('a single-parameter built-in still works on the engine path', () => {
    const { store } = engineWith(new FunctionRegistry(registry));
    store.setCell(0, 0, { text: '=UPPER("formula")', formula: '=UPPER("formula")' });
    expect(store.getCell(0, 0)?.value).toBe('FORMULA');
  });

  it('a bare evaluate() call without a context hands the function undefined', () => {
    const table = new FunctionRegistry(registry);
    table.register('WHERE', WHERE);
    const ast = new FormulaParser().parse('=WHERE()');
    expect(ast).not.toBeNull();
    // No currentCell / sheetId: conditional-format and validation rules
    // evaluate this way, so ctx-aware functions receive undefined, not
    // invented coordinates.
    const value = evaluate(ast!, () => null, undefined, { registry: table });
    expect(value).toBe('no-ctx');
  });
});

describe('installApiFunctions on a chosen table', () => {
  const iface: ApiInterface = { id: 'x', name: 'X', method: 'GET', urlPattern: '/x', fallback: 'error' };
  const projectOf = (v: number): MockProject => ({
    name: `p${v}`,
    interfaces: [iface],
    rules: [{ id: `r${v}`, interfaceId: 'x', name: 'k', matchers: {}, response: { kind: 'static', body: { k: v } }, fault: 'none', enabled: true, priority: 10 }],
    scenarios: [{ id: 's', name: 'S', description: '', rules: {} }],
  });

  function engineFor(table: FunctionRegistry, hub: MockHub): { store: Store; engine: FormulaEngine } {
    installApiFunctions(hub, table);
    const store = new Store();
    const engine = new FormulaEngine(store, { registry: table });
    createFormulaSync(store, engine);
    store.setCell(0, 0, { text: '=API.GET("/x","k")', formula: '=API.GET("/x","k")' });
    return { store, engine };
  }

  it('two hubs on two private tables resolve independently', () => {
    const t1 = new FunctionRegistry(registry);
    const t2 = new FunctionRegistry(registry);
    const a = engineFor(t1, new MockHub(projectOf(1)));
    const b = engineFor(t2, new MockHub(projectOf(2)));
    expect(a.store.getCell(0, 0)?.value).toBe(1);
    expect(b.store.getCell(0, 0)?.value).toBe(2);
    // A full recalculation keeps the answers apart, too.
    a.engine.recalculateAll();
    b.engine.recalculateAll();
    expect(a.store.getCell(0, 0)?.value).toBe(1);
    expect(b.store.getCell(0, 0)?.value).toBe(2);
  });

  it('the default argument still lands on the shared table', () => {
    installApiFunctions(new MockHub(projectOf(9)));
    try {
      expect(registry.hasOwn('API.GET')).toBe(true);
      expect(registry.has('API.GET')).toBe(true);
    } finally {
      // Leave the shared table exactly as it was.
      registry.remove('API.GET');
      registry.remove('API.POST');
      registry.remove('API.DATA');
    }
  });
});
