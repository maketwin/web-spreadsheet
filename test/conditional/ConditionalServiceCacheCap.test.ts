import { describe, expect, it } from 'vitest';
import { Store } from '../../src/store/Store';
import { ConditionalService, MAX_CACHED_RULE_FORMULAS } from '../../src/conditional/ConditionalService';

/** The rule-formula AST cache is private; the tests below observe its size. */
const astCacheOf = (service: ConditionalService): Map<string, unknown> =>
  (service as unknown as { astCache: Map<string, unknown> }).astCache;

/**
 * A formula rule over a 10×6 range: every visited cell parses its own shifted
 * variant (`=A1>5` at the anchor, `=B2>5` one step in, …), so walking the
 * range end to end used to leave one cached AST per visited cell, forever.
 */
const RANGE_ROWS = 10;
const RANGE_COLS = 6;
const RANGE_CELLS = RANGE_ROWS * RANGE_COLS;

function walkRange(visit: (r: number, c: number) => void): void {
  for (let r = 0; r < RANGE_ROWS; r += 1) {
    for (let c = 0; c < RANGE_COLS; c += 1) visit(r, c);
  }
}

function storeWithRule(): Store {
  const store = new Store();
  walkRange((r, c) => {
    const value = r * RANGE_COLS + c;
    store.setCell(r, c, { text: String(value), value });
  });
  store.setConditionalRule(`0,0:${RANGE_ROWS - 1},${RANGE_COLS - 1}`, [{ type: 'formula', formula: '=A1>5', style: { bgcolor: '#FFFF00' } }]);
  return store;
}

describe('ConditionalService rule-formula AST cache cap', () => {
  const CAP = 40; // small so the walk crosses the clear threshold

  it('accepts the cap as an optional constructor argument', () => {
    const service = new ConditionalService(CAP);
    expect(astCacheOf(service).size).toBe(0);
  });

  it('never caches more than the cap while walking past it', () => {
    const service = new ConditionalService(CAP);
    const cache = astCacheOf(service);
    const store = storeWithRule();
    let visited = 0;
    walkRange((r, c) => {
      service.computeOverlay(store, r, c);
      expect(cache.size).toBeLessThanOrEqual(CAP);
      visited += 1;
    });
    // The walk really crossed the clear threshold (60 distinct shifted formulas).
    expect(visited).toBe(RANGE_CELLS);
    expect(cache.size).toBeGreaterThan(0);
  });

  it('keeps results correct after the cache cleared mid-walk', () => {
    const service = new ConditionalService(CAP);
    const store = storeWithRule();
    walkRange((r, c) => service.computeOverlay(store, r, c));
    // The shifted formulas re-parse after a clear: truthiness is unchanged
    // (the formula is shifted to the cell itself, so cell value > 5 hits).
    expect(service.computeOverlay(store, 0, 0).style).toBeUndefined();
    expect(service.computeOverlay(store, 1, 0).style?.bgcolor).toBe('#FFFF00');
    expect(service.computeOverlay(store, 9, 5).style?.bgcolor).toBe('#FFFF00');
  });

  it('defaults to the exported 40_000 cap', () => {
    expect(MAX_CACHED_RULE_FORMULAS).toBe(40_000);
    // Above one full grid (1000×26), so a completely visited rule never thrashes.
    expect(MAX_CACHED_RULE_FORMULAS).toBeGreaterThan(1000 * 26);
  });
});
