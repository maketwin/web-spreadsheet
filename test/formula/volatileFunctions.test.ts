import { afterEach, describe, expect, it } from 'vitest';
import { FormulaEngine } from '../../src/formula/FormulaEngine';
import { FunctionRegistry, registry, type FunctionSpec } from '../../src/formula/registry';
import { createFormulaSync } from '../../src/formula/formulaSync';
import { Store } from '../../src/store/Store';
import type { CellValue } from '../../src/types';

// Volatile functions (FunctionSpec.volatile, e.g. NOW / TODAY): Excel
// re-evaluates their cells on every recalculation pass that has other work —
// they have no precedents, so nothing else would ever wake them.

const table = new FunctionRegistry(registry);

let ticks = 0;
const TICK: FunctionSpec = { minArgs: 0, maxArgs: 0, evaluate: () => { ticks += 1; return ticks; } };
const VTICK: FunctionSpec = { minArgs: 0, maxArgs: 0, volatile: true, evaluate: () => { ticks += 1; return ticks; } };
const CONST42: FunctionSpec = { minArgs: 0, maxArgs: 0, volatile: true, evaluate: () => 42 };

function setup(): {
  store: Store;
  engine: FormulaEngine;
  put: (r: number, c: number, text: string) => void;
  value: (r: number, c: number) => CellValue | undefined;
} {
  const store = new Store();
  const engine = new FormulaEngine(store, { registry: table });
  createFormulaSync(store, engine);
  const put = (r: number, c: number, text: string): void => {
    store.setCell(r, c, text.startsWith('=') ? { text, formula: text } : { text, value: Number(text) });
  };
  return { store, engine, put, value: (r, c) => store.getCell(r, c)?.value };
}

afterEach(() => {
  ticks = 0;
});

describe('volatile functions', () => {
  it('NOW / TODAY are marked volatile in the shared table', () => {
    expect(registry.get('TODAY')?.volatile).toBe(true);
    expect(registry.get('NOW')?.volatile).toBe(true);
  });

  it('a plain function keeps its value when an unrelated cell changes', () => {
    table.register('TICK', TICK);
    try {
      const { put, value } = setup();
      put(0, 1, '=TICK()');
      expect(value(0, 1)).toBe(1);
      put(0, 0, '5'); // unrelated cell
      expect(value(0, 1)).toBe(1);
    } finally {
      table.remove('TICK');
    }
  });

  it('a volatile function re-evaluates when an unrelated cell changes', () => {
    table.register('VTICK', VTICK);
    try {
      const { put, value } = setup();
      put(0, 1, '=VTICK()');
      expect(value(0, 1)).toBe(1);
      put(0, 0, '5'); // unrelated cell, real change: a pass with other work
      expect(value(0, 1)).toBe(2);
    } finally {
      table.remove('VTICK');
    }
  });

  it('an unchanged volatile result writes nothing (no cell event for the formula cell)', () => {
    table.register('CONST42', CONST42);
    try {
      const { store, put } = setup();
      put(0, 1, '=CONST42()');
      expect(store.getCell(0, 1)?.value).toBe(42);
      const cellEvents: { r: number; c: number }[] = [];
      const off = store.subscribe((e) => { if (e.type === 'cell') cellEvents.push({ r: e.r, c: e.c }); });
      put(0, 0, '5');
      off();
      // Only the edit itself lands; the idempotent putCell gate keeps the
      // recalculated-but-unchanged formula cell silent.
      expect(cellEvents).toEqual([{ r: 0, c: 0 }]);
    } finally {
      table.remove('CONST42');
    }
  });

  it('a drain with no work does not stir volatile formulas (in-place rewrite of a plain cell)', () => {
    table.register('VTICK', VTICK);
    try {
      const { put, value } = setup();
      put(0, 1, '=VTICK()');
      put(0, 0, '5');
      expect(value(0, 1)).toBe(2);
      // Same content again: the store still announces the cell, but the engine
      // sees the value it computed from, so the pass has nothing to do and the
      // volatile formula must not re-evaluate.
      put(0, 0, '5');
      expect(value(0, 1)).toBe(2);
    } finally {
      table.remove('VTICK');
    }
  });

  it('a volatile formula overwritten by a constant stops re-evaluating', () => {
    table.register('VTICK', VTICK);
    try {
      const { put, value } = setup();
      put(0, 1, '=VTICK()');
      expect(value(0, 1)).toBe(1);
      put(0, 1, '9'); // formula replaced by a constant
      ticks = 0;
      put(0, 0, '5');
      expect(ticks).toBe(0);
      expect(value(0, 1)).toBe(9);
    } finally {
      table.remove('VTICK');
    }
  });

  it('reset() + reloadFromStore() rebuilds the volatile set to match the workbook', () => {
    table.register('VTICK', VTICK);
    try {
      const { engine, put, value } = setup();
      put(0, 1, '=VTICK()');
      expect(value(0, 1)).toBe(1);
      engine.reset();
      engine.reloadFromStore();
      // The reload re-registered the formula and evaluated it once more.
      expect(value(0, 1)).toBe(2);
      ticks = 0;
      put(0, 0, '5');
      expect(value(0, 1)).toBe(1); // ticks 0 -> 1: the volatile pass re-evaluated it
    } finally {
      table.remove('VTICK');
    }
  });
});
