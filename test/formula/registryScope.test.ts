import { describe, expect, it } from 'vitest';
import { CommandManager } from '../../src/commands/CommandManager';
import { createFormulaSync } from '../../src/formula/formulaSync';
import { FormulaEngine } from '../../src/formula/FormulaEngine';
import { FunctionRegistry, registry, type FunctionSpec } from '../../src/formula/registry';
import { PluginAPI, type PluginHost } from '../../src/plugin/PluginAPI';
import { EventBus } from '../../src/events/EventBus';
import { Store } from '../../src/store/Store';
import type { CellValue } from '../../src/types';

const DOUBLE: FunctionSpec = { minArgs: 1, maxArgs: 1, evaluate: ([n]) => Number(Array.isArray(n) ? n[0] : n) * 2 };

/** An engine with its formula sync attached, holding one formula in A1. */
function engineWith(formula: string, options?: { readonly registry?: FunctionRegistry }): { store: Store; engine: FormulaEngine } {
  const store = new Store();
  const engine = new FormulaEngine(store, options);
  createFormulaSync(store, engine);
  store.setCell(0, 0, { text: formula, formula });
  return { store, engine };
}

const result = (store: Store): CellValue | undefined => store.getCell(0, 0)?.value;

describe('function registry scope', () => {
  it('an engine without options resolves against the shared table, as before', () => {
    const { store, engine } = engineWith('=SCOPEPROBE()');
    expect(engine.registry).toBe(registry);
    expect(result(store)).toBe('#NAME?');
    registry.register('SCOPEPROBE', { minArgs: 0, maxArgs: 0, evaluate: () => 'shared' });
    try {
      const again = engineWith('=SCOPEPROBE()');
      expect(result(again.store)).toBe('shared');
    } finally {
      registry.remove('SCOPEPROBE');
    }
  });

  it('a private table keeps its registrations from other engines and still sees the shared ones', () => {
    const own = new FunctionRegistry(registry);
    const a = engineWith('=SCOPEDOUBLE(21)', { registry: own });
    const b = engineWith('=SCOPEDOUBLE(21)');
    own.register('SCOPEDOUBLE', DOUBLE);
    a.engine.recalculateAll();
    b.engine.recalculateAll();
    expect(result(a.store)).toBe(42);
    expect(result(b.store)).toBe('#NAME?');
    // Built-ins come through the parent chain.
    const sum = engineWith('=SUM(1,2)', { registry: own });
    expect(result(sum.store)).toBe(3);
    expect(own.has('SUM')).toBe(true);
    expect(own.list()).toContain('SUM');
    expect(own.list()).toContain('SCOPEDOUBLE');
    expect(registry.has('SCOPEDOUBLE')).toBe(false);
  });

  it('a private table may override a built-in for its engine only; removing falls back to the shared definition', () => {
    const own = new FunctionRegistry(registry);
    const a = engineWith('=SUM(1,2)', { registry: own });
    const b = engineWith('=SUM(1,2)');
    own.register('SUM', { minArgs: 1, maxArgs: 255, evaluate: () => 'private' });
    a.engine.recalculateAll();
    expect(result(a.store)).toBe('private');
    expect(result(b.store)).toBe(3);
    own.remove('SUM');
    a.engine.recalculateAll();
    expect(result(a.store)).toBe(3);
  });

  it('api.registerFunction lands on the host engine table; its undo restores what was there', () => {
    const own = new FunctionRegistry(registry);
    const store = new Store();
    const engine = new FormulaEngine(store, { registry: own });
    const host: PluginHost = { store, cmdManager: new CommandManager(store), events: new EventBus(), formula: engine };
    const api = new PluginAPI(host);
    const other = engineWith('=APIDouble(5)');

    const undo = api.registerFunction('APIDouble', DOUBLE);
    const here = engineWith('=APIDouble(5)', { registry: own });
    expect(result(here.store)).toBe(10);
    other.engine.recalculateAll();
    expect(result(other.store)).toBe('#NAME?');

    undo();
    here.engine.recalculateAll();
    expect(result(here.store)).toBe('#NAME?');
    expect(own.has('APIDouble')).toBe(false);
  });
});
