import { readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parseInternalRange, shiftInternalRange } from '../../src/util/rangeNotation';
import type * as NotationModule from '../../src/util/rangeNotation';
import { parseInternalRangeKey } from '../../src/sparkline/values';
import { parseNameBoxInput } from '../../src/selection/nameBox';
import { NamedRangeService } from '../../src/namedrange/NamedRangeService';
import { SheetData } from '../../src/store/SheetData';
import { Store } from '../../src/store/Store';
import { ConditionalService } from '../../src/conditional/ConditionalService';
import { DataValidationService } from '../../src/validation/DataValidationService';
import { shiftSheetFormulas } from '../../src/commands/impl/shiftFormulas';
import type { ValidationRule } from '../../src/validation/types';

/**
 * Counts cross-module parses of the shared parser so the hot-path guard can
 * budget them. The mock wraps (never replaces) the real implementation.
 */
const parseCalls = vi.hoisted(() => ({ count: 0 }));
vi.mock('../../src/util/rangeNotation', async (importOriginal) => {
  const actual = await importOriginal<typeof NotationModule>();
  return {
    ...actual,
    parseInternalRange: (key: string) => {
      parseCalls.count += 1;
      return actual.parseInternalRange(key);
    },
  };
});

/**
 * Characterization suite for the internal range notation ("r,c" / "r1,c1:r2,c2").
 *
 * Before the notation gets a single parser (`util/rangeNotation.parseInternalRange`)
 * every call site hand-rolled its own `split(':') + split(',') + map(Number)`
 * with subtly different semantics. This file pins, per call site, what each
 * input of the shared matrix produced BEFORE the unification. Assertions whose
 * behaviour intentionally changes during the unification are marked PRE-UNIFY
 * and updated together with the refactor.
 *
 * Call sites that are module-private and only reachable through IO or React
 * (sheetXmlExport.parseRangeKey, chartXmlExport.parseRange + its inline anchor
 * split, chartXmlImport.clampRangeToGrid, FloatingChart.parseRangeKey +
 * legacyAnchor, ConditionalRulesDialog.rangeKeyToA1, FormulaEngine's private
 * parseInternalRange) have no direct assertions here — their observation
 * method is noted next to the site list below:
 * - sheetXmlExport: export a sheet and read `conditionalFormatting/@sqref`
 *   resp. `dataValidation/@sqref` from the xl/worksheets XML.
 * - chartXmlExport: an anchor-less chart's twoCellAnchor from/to row/col.
 * - chartXmlImport: import a crafted drawing XML and inspect ChartSpec.range.
 * - FloatingChart: render a legacy anchor-less spec; the anchor parks
 *   below/right of spec.range's end cell.
 * - ConditionalRulesDialog: the 范围 column shows the A1 label of each key.
 * - FormulaEngine: `=SUM(Sales)` over a named range (covered by the
 *   namedrange/formula suites for well-formed keys).
 */

const INTEGER_RULE: ValidationRule = { type: 'integer', min: 0, max: 9 };

describe('internal range notation — shiftInternalRange (site: util/rangeNotation)', () => {
  it('inserts two rows at the top for every matrix key (unified behaviour)', () => {
    // "r,c" single cells shift and stay single; ranges shift with normalised
    // corners; every unparsable key (floats, whitespace, a third ":9"
    // segment) comes back unchanged.
    expect(shiftInternalRange('2,3', 'row', 0, 2)).toBe('4,3');
    expect(shiftInternalRange('2,3:5,7', 'row', 0, 2)).toBe('4,3:7,7');
    // CHANGED vs pre-unify: old code shifted each colon part independently and
    // could yield "4,7:7,3" (per-part columns); corners are normalised first now.
    expect(shiftInternalRange('5,7:2,3', 'row', 0, 2)).toBe('4,3:7,7');
    expect(shiftInternalRange('2,3:5', 'row', 0, 2)).toBe('2,3:5'); // unparsable → unchanged
    expect(shiftInternalRange('2,3:', 'row', 0, 2)).toBe('2,3:'); // unparsable → unchanged
    expect(shiftInternalRange('a,b', 'row', 0, 2)).toBe('a,b'); // unparsable → unchanged
    expect(shiftInternalRange('', 'row', 0, 2)).toBe(''); // unparsable → unchanged
    // CHANGED: old ignored the 3rd segment and shifted anyway.
    expect(shiftInternalRange('2,3:5,7:9', 'row', 0, 2)).toBe('2,3:5,7:9');
    // CHANGED: old tolerated whitespace/floats via Number(); now strict.
    expect(shiftInternalRange(' 2,3', 'row', 0, 2)).toBe(' 2,3');
    expect(shiftInternalRange('2.5,3', 'row', 0, 2)).toBe('2.5,3');
    expect(shiftInternalRange('-1,0', 'row', 0, 2)).toBe('-1,0'); // negative rows sit below the insertion point → unchanged
    expect(shiftInternalRange(' 2,3:5,7 ', 'row', 0, 2)).toBe(' 2,3:5,7 ');
  });

  it('column inserts and full-row deletion (unchanged behaviour)', () => {
    expect(shiftInternalRange('2,3:5,7', 'col', 0, 1)).toBe('2,4:5,8');
    expect(shiftInternalRange('1,0:2,5', 'row', 1, -2)).toBeNull(); // fully deleted
    expect(shiftInternalRange('0,0:0,5', 'row', 0, -1)).toBeNull();
    expect(shiftInternalRange('2,3:2,5', 'row', 0, -1)).toBe('1,3:1,5'); // shrink from the top
  });
});

describe('internal range notation — parseInternalRangeKey (site: sparkline/values, public export)', () => {
  it('normalizes corners; every matrix result keeps its exact legacy shape (unchanged behaviour)', () => {
    expect(parseInternalRangeKey('2,3')).toEqual({ r1: 2, c1: 3, r2: 2, c2: 3 });
    expect(parseInternalRangeKey('2,3:5,7')).toEqual({ r1: 2, c1: 3, r2: 5, c2: 7 });
    expect(parseInternalRangeKey('5,7:2,3')).toEqual({ r1: 2, c1: 3, r2: 5, c2: 7 }); // normalized
    expect(parseInternalRangeKey('2,3:5')).toEqual({ r1: 2, c1: 3, r2: 5, c2: 3 }); // legacy: missing c2 falls back to c1
    expect(parseInternalRangeKey('2,3:')).toEqual({ r1: 0, c1: 3, r2: 2, c2: 3 }); // legacy: Number('') is 0, so the empty end becomes corner 0
    expect(parseInternalRangeKey('a,b')).toEqual({ r1: NaN, c1: NaN, r2: NaN, c2: NaN });
    expect(parseInternalRangeKey('')).toEqual({ r1: 0, c1: 0, r2: 0, c2: 0 }); // legacy: Number('') is 0
    expect(parseInternalRangeKey('2,3:5,7:9')).toEqual({ r1: 2, c1: 3, r2: 5, c2: 7 }); // 3rd segment ignored
    expect(parseInternalRangeKey(' 2,3')).toEqual({ r1: 2, c1: 3, r2: 2, c2: 3 }); // whitespace tolerated
    expect(parseInternalRangeKey('2.5,3')).toEqual({ r1: 2.5, c1: 3, r2: 2.5, c2: 3 }); // floats kept
    expect(parseInternalRangeKey('-1,0')).toEqual({ r1: -1, c1: 0, r2: -1, c2: 0 });
    expect(parseInternalRangeKey(' 2,3:5,7 ')).toEqual({ r1: 2, c1: 3, r2: 5, c2: 7 });
  });
});

describe('internal range notation — SheetData.getValidationRule (site: store/SheetData.cellInRange)', () => {
  it('matrix behaviour of the membership test (unified behaviour)', () => {
    const hit = (key: string, r: number, c: number): boolean => {
      const sheet = new SheetData();
      sheet.setValidationRule(key, INTEGER_RULE);
      return sheet.getValidationRule(r, c) !== undefined;
    };
    expect(hit('2,3', 2, 3)).toBe(true);
    expect(hit('2,3', 2, 4)).toBe(false);
    expect(hit('2,3:5,7', 2, 3)).toBe(true);
    expect(hit('2,3:5,7', 5, 7)).toBe(true);
    expect(hit('2,3:5,7', 5, 8)).toBe(false);
    expect(hit('2,3:5,7', 6, 7)).toBe(false);
    // CHANGED: reversed keys matched nothing before (raw r >= start ordering); corners are normalised now.
    expect(hit('5,7:2,3', 2, 3)).toBe(true);
    expect(hit('5,7:2,3', 5, 7)).toBe(true);
    expect(hit('2,3:5', 2, 3)).toBe(false); // unparsable → no rule
    expect(hit('2,3:', 2, 3)).toBe(false); // unparsable → no rule
    expect(hit('a,b', 2, 3)).toBe(false);
    expect(hit('', 2, 3)).toBe(false);
    // CHANGED: whitespace keys used to parse (Number trims) and match; strict now.
    expect(hit(' 2,3', 2, 3)).toBe(false);
    expect(hit('2.5,3', 2, 3)).toBe(false); // float corner: unparsable → no rule
    expect(hit('-1,0', -1, 0)).toBe(true); // negative cells matched, then and now
    expect(hit('-1,0', 0, 0)).toBe(false);
    // CHANGED: Number('') is 0, so the empty key used to match cell (0,0); unparsable now.
    expect(hit('', 0, 0)).toBe(false);
    expect(hit(' 2,3:5,7 ', 2, 3)).toBe(false);
  });
});

describe('internal range notation — NamedRangeService (site: private parseInternalRange)', () => {
  const svc = new NamedRangeService();
  const a1 = (store: Store, range: string): string | undefined => {
    svc.add(store, 'Sales', range);
    const result = svc.resolveToA1(store, 'Sales');
    svc.remove(store, 'Sales');
    return result;
  };

  it('resolveToA1 over the matrix (unified behaviour)', () => {
    const store = new Store();
    expect(a1(store, '2,3')).toBe('D3:D3');
    expect(a1(store, '2,3:5,7')).toBe('D3:H6');
    // CHANGED: old kept the raw corner order ("H6:D3"); normalised now.
    expect(a1(store, '5,7:2,3')).toBe('D3:H6');
    // CHANGED: the old parser was lenient (missing coords fell back to the
    // start corner, Number('') coerced to 0, whitespace trimmed, floats kept),
    // so "2,3:5" resolved to "D3:D6" and "2,3:" to "D3:D1". All unparsable
    // keys resolve to nothing now — and junk no longer crashes xy2expr.
    expect(a1(store, '2,3:5')).toBeUndefined();
    expect(a1(store, '2,3:')).toBeUndefined();
    expect(a1(store, 'a,b')).toBeUndefined();
    expect(a1(store, '')).toBeUndefined();
    expect(a1(store, '2,3:5,7:9')).toBeUndefined();
    expect(a1(store, ' 2,3')).toBeUndefined();
    expect(a1(store, '2.5,3')).toBeUndefined();
    expect(() => a1(store, '-1,0')).toThrow(); // unchanged: "-1,0" still parses (negatives are legal), xy2expr still rejects the negative row
    expect(a1(store, ' 2,3:5,7 ')).toBeUndefined();
  });

  it('resolveFormula over representative keys (unified behaviour)', () => {
    const store = new Store();
    const inline = (range: string): string => {
      svc.add(store, 'Sales', range);
      const result = svc.resolveFormula(store, '=SUM(Sales)');
      svc.remove(store, 'Sales');
      return result;
    };
    expect(inline('2,3:5,7')).toBe('=SUM(2,3:5,7)');
    // CHANGED: corners normalised before re-inlining.
    expect(inline('5,7:2,3')).toBe('=SUM(2,3:5,7)');
    // CHANGED: unparsable keys used to inline "NaN,NaN:NaN,NaN"-style junk;
    // the name is now left alone instead.
    expect(inline('a,b')).toBe('=SUM(Sales)');
    expect(inline('')).toBe('=SUM(Sales)');
    expect(inline('2,3:')).toBe('=SUM(Sales)');
    expect(inline('2,3:5')).toBe('=SUM(Sales)');
  });
});

describe('internal range notation — nameBox defined-name jump (site: selection/nameBox)', () => {
  const target = (range: string): ReturnType<typeof parseNameBoxInput> => {
    const store = new Store();
    new NamedRangeService().add(store, 'Sales', range);
    return parseNameBoxInput(store, 'Sales');
  };

  it('matrix behaviour (unified behaviour)', () => {
    expect(target('2,3')?.range).toEqual({ r1: 2, c1: 3, r2: 2, c2: 3 });
    expect(target('2,3:5,7')?.range).toEqual({ r1: 2, c1: 3, r2: 5, c2: 7 });
    // CHANGED: old clampRange kept the raw reversed corners {5,7,2,3}; normalised now.
    expect(target('5,7:2,3')?.range).toEqual({ r1: 2, c1: 3, r2: 5, c2: 7 });
    // CHANGED: the old parser was lenient — "2,3:5" jumped to {2,3,5,3},
    // "2,3:" to {2,3,0,3}, "a,b" to an all-NaN selection, "2,3:5,7:9"
    // ignored its third segment, and whitespace/float keys parsed. All of
    // them resolve to nothing now.
    expect(target('2,3:5')).toBeNull();
    expect(target('2,3:')).toBeNull();
    expect(target('a,b')).toBeNull();
    expect(target('')).toBeNull();
    expect(target('2,3:5,7:9')).toBeNull();
    expect(target(' 2,3')).toBeNull();
    expect(target('2.5,3')).toBeNull();
    expect(target('-1,0')?.range).toEqual({ r1: 0, c1: 0, r2: 0, c2: 0 }); // clamped to the grid, then and now
    expect(target(' 2,3:5,7 ')).toBeNull();
  });
});

describe('internal range notation — ConditionalService.computeOverlay (site: private parseRangeKey)', () => {
  const overlayAt = (key: string, r: number, c: number): unknown => {
    const store = new Store();
    store.setCell(r, c, { text: '10', value: 10 });
    store.setConditionalRule(key, [{ type: 'cellValue', operator: 'gt', value: 5, style: { bgcolor: '#FFFF00' } }]);
    return new ConditionalService().computeOverlay(store, r, c);
  };

  it('matrix behaviour (unified behaviour)', () => {
    expect(overlayAt('2,3:5,7', 2, 3)).toEqual({ style: { bgcolor: '#FFFF00' } });
    expect(overlayAt('5,7:2,3', 2, 3)).toEqual({ style: { bgcolor: '#FFFF00' } }); // normalized corners, then and now
    // CHANGED: single-cell keys ("2,3") used to be rejected (both colon parts
    // were required) and never painted; they parse now.
    expect(overlayAt('2,3', 2, 3)).toEqual({ style: { bgcolor: '#FFFF00' } });
    expect(overlayAt('2,3:5', 2, 3)).toEqual({});
    expect(overlayAt('a,b', 2, 3)).toEqual({});
    expect(overlayAt('', 2, 3)).toEqual({});
    // CHANGED: whitespace keys used to parse (Number trims) and the third
    // ":9" segment used to be ignored; both skip now.
    expect(overlayAt(' 2,3:5,7 ', 2, 3)).toEqual({});
    expect(overlayAt('2.5,3', 2, 3)).toEqual({}); // non-integer → skipped, then and now
    expect(overlayAt('2,3:5,7:9', 2, 3)).toEqual({});
  });
});

describe('internal range notation — DataValidationService custom origin (site: private parseRuleRange)', () => {
  /**
   * ruleOrigin finds the stored range holding the same custom formula and
   * shifts it to the validated cell; a whitespace key parses today, so the
   * formula is anchored at the stored top-left instead of the validated cell.
   */
  const anchored = (key: string, r: number, c: number): boolean => {
    const store = new Store();
    store.setCell(0, 0, { text: '1', value: 1 });
    store.setCell(1, 0, { text: '2', value: 2 });
    store.setValidationRule(key, { type: 'custom', formula: '=A1=2' });
    // Candidate "2" satisfies the anchored variant ("=A2=2" reads the validated
    // cell) but not the unanchored one ("=A1=2" reads the stored A1=1).
    const result = new DataValidationService().validate('2', { type: 'custom', formula: '=A1=2' }, { store, r, c });
    store.removeValidationRule(key);
    return result.valid;
  };

  it('matrix behaviour (unified behaviour)', () => {
    expect(anchored('0,0:1,1', 1, 0)).toBe(true); // anchored at stored top-left → "=A2=2" reads the candidate 2
    // CHANGED: the whitespace key used to parse (Number trims) and anchor; it is skipped now.
    expect(anchored(' 0,0:1,1 ', 1, 0)).toBe(false);
    expect(anchored('2,3', 1, 0)).toBe(false); // (1,0) outside "2,3" either way → unanchored fallback, same result
    expect(anchored('5,7:2,3', 1, 0)).toBe(false); // reversed normalized away, but (1,0) still outside
    expect(anchored('2,3:5,7:9', 1, 0)).toBe(false); // 3rd segment: unparsable now (was ignored before) — same outcome here
  });
});

describe('internal range notation — shiftAutoFilter (site: commands/impl/shiftFormulas)', () => {
  it('column insert re-keys the autofilter range (unchanged behaviour)', () => {
    const store = new Store();
    store.setAutoFilter({ range: { r1: 0, c1: 0, r2: 2, c2: 5 }, criteria: {} });
    shiftSheetFormulas(store, 'col', 0, 1);
    expect(store.getAutoFilter()?.range).toEqual({ r1: 0, c1: 1, r2: 2, c2: 6 });
  });

  it('row deletion removing the autofilter clears it (unchanged behaviour)', () => {
    const store = new Store();
    store.setAutoFilter({ range: { r1: 0, c1: 0, r2: 0, c2: 5 }, criteria: {} });
    shiftSheetFormulas(store, 'row', 0, -1);
    expect(store.getAutoFilter()).toBeUndefined();
  });
});

describe('parseInternalRange — the unified parser', () => {
  it('accepts the matrix keys the old sites agreed on', () => {
    expect(parseInternalRange('2,3')).toEqual({ r1: 2, c1: 3, r2: 2, c2: 3 }); // single cell doubles as its own end
    expect(parseInternalRange('2,3:5,7')).toEqual({ r1: 2, c1: 3, r2: 5, c2: 7 });
    expect(parseInternalRange('-1,0')).toEqual({ r1: -1, c1: 0, r2: -1, c2: 0 }); // negatives are legal integers
    expect(parseInternalRange('0,0')).toEqual({ r1: 0, c1: 0, r2: 0, c2: 0 });
  });

  it('normalizes reversed corners', () => {
    expect(parseInternalRange('5,7:2,3')).toEqual({ r1: 2, c1: 3, r2: 5, c2: 7 });
    expect(parseInternalRange('5,3:2,7')).toEqual({ r1: 2, c1: 3, r2: 5, c2: 7 });
    expect(parseInternalRange('-1,-6:-5,0')).toEqual({ r1: -5, c1: -6, r2: -1, c2: 0 });
  });

  it('rejects everything else with null', () => {
    expect(parseInternalRange('2,3:5')).toBeNull(); // missing coordinate
    expect(parseInternalRange('2,3:')).toBeNull(); // empty segment (Number('') would have coerced to 0)
    expect(parseInternalRange('a,b')).toBeNull(); // non-numeric
    expect(parseInternalRange('')).toBeNull();
    expect(parseInternalRange('2,3:5,7:9')).toBeNull(); // extra segment
    expect(parseInternalRange(' 2,3')).toBeNull(); // leading whitespace
    expect(parseInternalRange('2,3:5,7 ')).toBeNull(); // trailing whitespace
    expect(parseInternalRange('2.5,3')).toBeNull(); // float
    expect(parseInternalRange('2,3,4:5,6')).toBeNull(); // extra coordinate
    expect(parseInternalRange('1e3,0')).toBeNull(); // exponent form is not a decimal integer literal
    expect(parseInternalRange('+2,0')).toBeNull(); // explicit sign other than '-' rejected
    expect(parseInternalRange(`${'9'.repeat(400)},0`)).toBeNull(); // digit storm overflows to Infinity
    expect(parseInternalRange('0x10,0')).toBeNull(); // hex literal is not decimal
  });
});

describe('parseInternalRange — cross-check against the pre-unification parsers', () => {
  /** ConditionalService's old parser (normalized corners, 4 strict integers). */
  function legacyConditionalParse(key: string): { r1: number; c1: number; r2: number; c2: number } | null {
    const [lo, hi] = key.split(':');
    if (lo === undefined || hi === undefined) return null;
    const nums = [...lo.split(','), ...hi.split(',')].map(Number);
    if (nums.length !== 4 || nums.some((n) => !Number.isInteger(n))) return null;
    const r1 = nums[0] ?? 0;
    const c1 = nums[1] ?? 0;
    const r2 = nums[2] ?? 0;
    const c2 = nums[3] ?? 0;
    return { r1: Math.min(r1, r2), c1: Math.min(c1, c2), r2: Math.max(r1, r2), c2: Math.max(c1, c2) };
  }

  /** FormulaEngine's old parser (no corner normalization, lenient fallbacks). */
  function legacyFormulaEngineParse(range: string): { r1: number; c1: number; r2: number; c2: number } | undefined {
    const parts = range.split(':');
    const start = parts[0]?.split(',').map(Number) ?? [];
    const end = parts[1]?.split(',').map(Number) ?? start;
    const r1 = start[0];
    const c1 = start[1];
    if (r1 === undefined || c1 === undefined || !Number.isFinite(r1) || !Number.isFinite(c1)) return undefined;
    const r2 = end[0] ?? r1;
    const c2 = end[1] ?? c1;
    if (!Number.isFinite(r2) || !Number.isFinite(c2)) return undefined;
    return { r1, c1, r2, c2 };
  }

  it('agrees with the old parsers on 1000 random valid keys', () => {
    let seed = 0x2f6e2b1;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const coord = (): number => Math.floor(next() * 2060) - 30; // -30..2029, negatives included
    for (let i = 0; i < 1000; i += 1) {
      const key = next() < 0.4
        ? `${coord()},${coord()}`
        : `${coord()},${coord()}:${coord()},${coord()}`;
      const unified = parseInternalRange(key);
      expect(unified, `key "${key}"`).not.toBeNull();
      const [head, tail] = key.split(':');
      // Keys are generated "r,c[:r,c]" — every coordinate exists.
      const [a, b] = head!.split(',').map(Number) as [number, number];
      if (tail === undefined) {
        // Every legacy site treats a single cell as its own end.
        expect(unified, `key "${key}"`).toEqual({ r1: a, c1: b, r2: a, c2: b });
        continue;
      }
      const [c, d] = tail.split(',').map(Number) as [number, number];
      // Old ConditionalService semantics (normalized) — must match exactly.
      expect(unified, `key "${key}"`).toEqual(legacyConditionalParse(key));
      const loose = legacyFormulaEngineParse(key);
      expect(loose, `key "${key}"`).toBeDefined();
      if (a <= c && b <= d) expect(unified, `key "${key}"`).toEqual(loose); // already ordered: every legacy site agreed
      else expect(unified, `key "${key}"`).toEqual({ r1: Math.min(a, c), c1: Math.min(b, d), r2: Math.max(a, c), c2: Math.max(b, d) });
    }
  });
});

describe('internal range notation — getValidationRule parse budget (hot path)', () => {
  it('parses each stored rule at most once per lookup', () => {
    const sheet = new SheetData();
    sheet.setValidationRule('0,0:1,1', INTEGER_RULE);
    sheet.setValidationRule('5,5:6,6', INTEGER_RULE);
    sheet.setValidationRule('10,10:11,11', INTEGER_RULE);
    const before = parseCalls.count;
    for (let i = 0; i < 100; i += 1) sheet.getValidationRule(0, 0);
    const delta = parseCalls.count - before;
    expect(delta).toBeGreaterThanOrEqual(100); // at least the covering rule is inspected per lookup
    expect(delta).toBeLessThanOrEqual(300); // at most one parse per stored rule per lookup — no extra parsing
  });
});

describe('internal range notation — no hand-rolled internal-notation splits left in src', () => {
  it("keeps split(':') confined to the designated notations", () => {
    const srcDir = resolve(process.cwd(), 'src');
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = resolve(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.tsx?$/.test(entry.name)) files.push(path);
      }
    };
    walk(srcDir);
    const counts: Record<string, number> = {};
    for (const file of files) {
      const hits = readFileSync(file, 'utf8').split('\n').filter((line) => line.includes("split(':')")).length;
      if (hits > 0) counts[relative(srcDir, file)] = hits;
    }
    /**
     * The only homes a colon split may still live in, with the notation each
     * one serves:
     * - util/rangeNotation.ts: parseInternalRange (the one internal-notation
     *   split) and parseRange (A1 notation).
     * - formula/parser.ts, formula/refRewrite.ts, io/chartXmlImport.ts:
     *   A1-style reference tokens, a different notation.
     * - sparkline/values.ts: compat fallback of the exported
     *   parseInternalRangeKey for unparsable keys (pinned above).
     */
    const allowlist: Record<string, number> = {
      'util/rangeNotation.ts': 2,
      'formula/parser.ts': 1,
      'formula/refRewrite.ts': 4,
      'io/chartXmlImport.ts': 1,
      'sparkline/values.ts': 1,
    };
    for (const [rel, count] of Object.entries(counts)) {
      expect(allowlist[rel], `unexpected split(':') in src/${rel} — parse internal notation via util/rangeNotation.parseInternalRange`).toBeDefined();
      expect(count, `src/${rel} gained a split(':')`).toBeLessThanOrEqual(allowlist[rel]!);
    }
    expect(Object.keys(counts).length, "split(':') disappeared from every designated home — prune the allowlist").toBeGreaterThan(0);
  });
});
