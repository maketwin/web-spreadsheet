import { describe, expect, it, vi } from 'vitest';
import { exportXlsxBuffer } from '../../src/io/XlsxExporter';
import { importXlsx } from '../../src/io/XlsxImporter';
import { Store } from '../../src/store/Store';
import { TOTAL_COLS, TOTAL_ROWS } from '../../src/util/gridSize';
import { CsvImportPlugin } from '../../src/plugin/CsvImportPlugin';
import { PluginManager } from '../../src/plugin/PluginManager';
import type { PluginHost } from '../../src/plugin/PluginAPI';
import type { CommandManager } from '../../src/commands/CommandManager';
import type { FormulaEngine } from '../../src/formula/FormulaEngine';
import { EventBus } from '../../src/events/EventBus';

// The grid is Excel's whole address space (1,048,576 × 16,384) and it is an
// address space, not an allocation: io work must track the file's stored
// cells, never the rectangle they happen to span. Each test pins one far-apart
// shape plus a cost guard (store-call counts / wall clock well under what a
// dense walk would need).

/**
 * Wall-clock ceilings. The first number is this machine's measurement; each
 * wall leaves an order of magnitude above it, because CI runs this suite under
 * coverage instrumentation (~2.6x here) on a slower, fully loaded runner. What
 * the walls rule out is the dense walk — minutes to hours — not a slow machine.
 */
const FAR_PAIR_EXPORT_MS = 5000; // measured 247 ms (2 cells, 1M-row extent)
const FAR_PAIR_IMPORT_MS = 1000; // measured 6 ms
const CORNER_EXPORT_MS = 1000; // measured 1 ms; a dense export would walk 17 billion addresses
const CORNER_IMPORT_MS = 1000; // measured 2 ms
const HUNDRED_K_EXPORT_MS = 6000; // measured 406 ms
const HUNDRED_K_IMPORT_MS = 4000; // measured 226 ms
const CSV_IMPORT_MS = 3000; // 200k lines × 3 columns, measured 151 ms

describe('io at the address-space scale', () => {
  it('round-trips two cells at opposite ends of the row space without dense work', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'top', value: 'top' });
    store.setCell(TOTAL_ROWS - 1, 0, { text: '1048576', value: 1048576 });
    expect(store.getUsedBounds()).toEqual({ r1: 0, c1: 0, r2: TOTAL_ROWS - 1, c2: 0 });

    const boundsSpy = vi.spyOn(Store.prototype, 'getUsedBounds');
    const getCellSpy = vi.spyOn(Store.prototype, 'getCell');
    const t0 = performance.now();
    const buf = exportXlsxBuffer(store);
    const exportMs = performance.now() - t0;
    const boundsCalls = boundsSpy.mock.calls.length;
    const getCellCalls = getCellSpy.mock.calls.length;
    boundsSpy.mockRestore();
    getCellSpy.mockRestore();

    const t1 = performance.now();
    const restored = Store.deserialize(importXlsx(buf));
    const importMs = performance.now() - t1;

    expect(restored.getUsedBounds()).toEqual({ r1: 0, c1: 0, r2: TOTAL_ROWS - 1, c2: 0 });
    expect(restored.getCell(0, 0)?.text).toBe('top');
    expect(restored.getCell(TOTAL_ROWS - 1, 0)?.text).toBe('1048576');
    expect(restored.getCell(TOTAL_ROWS - 1, 0)?.value).toBe(1048576);

    // Cost guards: the export derives its extent from the store's used bounds
    // (not from padding a dense array down to A1) and reads a bounded number
    // of cells — two stored cells, never a million-row walk.
    expect(boundsCalls).toBeGreaterThanOrEqual(1);
    expect(getCellCalls).toBeLessThanOrEqual(2 + 8);
    expect(exportMs).toBeLessThan(FAR_PAIR_EXPORT_MS);
    expect(importMs).toBeLessThan(FAR_PAIR_IMPORT_MS);
  });

  it('round-trips the corner cell XFD1048576', () => {
    const store = new Store();
    store.setCell(TOTAL_ROWS - 1, TOTAL_COLS - 1, { text: 'corner', value: 'corner' });

    const t0 = performance.now();
    const buf = exportXlsxBuffer(store);
    const exportMs = performance.now() - t0;
    const t1 = performance.now();
    const restored = Store.deserialize(importXlsx(buf));
    const importMs = performance.now() - t1;

    expect(restored.getCell(TOTAL_ROWS - 1, TOTAL_COLS - 1)?.text).toBe('corner');
    expect(restored.getUsedBounds()).toEqual({
      r1: TOTAL_ROWS - 1, c1: TOTAL_COLS - 1, r2: TOTAL_ROWS - 1, c2: TOTAL_COLS - 1,
    });
    // A dense export of this sheet would iterate 1,048,576 × 16,384 addresses.
    expect(exportMs).toBeLessThan(CORNER_EXPORT_MS);
    expect(importMs).toBeLessThan(CORNER_IMPORT_MS);
  });

  it('round-trips 100k cells (numbers, text, formulas, number formats, one merge)', () => {
    const ROWS = 10_000;
    const COLS = 10;
    const source = new Store();
    source.setStyle('pct', { numberFormat: 'percent' });
    for (let r = 0; r < ROWS; r += 1) {
      for (let c = 0; c < COLS; c += 1) {
        if (c === 9 && r % 50 === 0) {
          source.setCell(r, c, { formula: `=A${r + 1}*2`, text: String(r * 2), value: r * 2 });
        } else if (c === 8 && r % 25 === 0) {
          source.setCell(r, c, { text: '50.00%', value: 0.5, styleId: 'pct' });
        } else if (c % 2 === 0) {
          source.setCell(r, c, { text: String(r + c), value: r + c });
        } else {
          source.setCell(r, c, { text: `t${r}-${c}`, value: `t${r}-${c}` });
        }
      }
    }
    source.addMerge('A1:B2');

    const t0 = performance.now();
    const buf = exportXlsxBuffer(source);
    const exportMs = performance.now() - t0;
    const t1 = performance.now();
    const imported = importXlsx(buf);
    const importMs = performance.now() - t1;

    const sheet = imported.sheets[0]!;
    const restored = new Map(sheet.data.cells);
    expect(restored.size).toBe(ROWS * COLS);
    expect(sheet.data.merges).toEqual(['A1:B2']);
    for (let r = 0; r < ROWS; r += 1) {
      for (let c = 0; c < COLS; c += 1) {
        const cell = restored.get(`${r},${c}`);
        expect(cell, `cell ${r},${c}`).toBeDefined();
        const expected = source.getCell(r, c)!;
        expect(cell!.text, `text ${r},${c}`).toBe(expected.text);
        expect(cell!.value, `value ${r},${c}`).toBe(expected.value);
        expect(cell!.formula, `formula ${r},${c}`).toBe(expected.formula);
      }
    }
    // The number format rides in the style table and comes back as its built-in name.
    const styleOf = (r: number, c: number) => {
      const id = restored.get(`${r},${c}`)?.styleId;
      return id === undefined ? undefined : sheet.data.styles.find(([styleId]) => styleId === id)?.[1];
    };
    expect(styleOf(0, 8)?.numberFormat).toBe('percent');
    expect(styleOf(1, 8)?.numberFormat).toBeUndefined();

    expect(exportMs).toBeLessThan(HUNDRED_K_EXPORT_MS);
    expect(importMs).toBeLessThan(HUNDRED_K_IMPORT_MS);
  });

  it('round-trips one column of 1,000,000 numbers (the old import limits refused the file)', () => {
    const source = new Store();
    source.batch(() => {
      for (let r = 0; r < 1_000_000; r += 1) source.setCell(r, 0, { text: String(r), value: r });
    });

    const buf = exportXlsxBuffer(source);
    const restored = Store.deserialize(importXlsx(buf));
    expect(restored.getCellCount()).toBe(1_000_000);
    expect(restored.getCell(0, 0)?.value).toBe(0);
    expect(restored.getCell(999_999, 0)?.value).toBe(999_999);
  }, 240_000);

  it('round-trips 1,200,000 numbers plus one bold cell (the styled post-processor used to drop the sheet)', () => {
    const source = new Store();
    source.setStyle('s-bold', { bold: true });
    source.batch(() => {
      // 120,000 × 10 dense block plus a bold cell far below the block: the
      // styles pass used to run its zip step under import size limits and
      // silently skip the oversized worksheet part it had just written.
      for (let r = 0; r < 120_000; r += 1) {
        for (let c = 0; c < 10; c += 1) source.setCell(r, c, { text: '1', value: 1 });
      }
      source.setCell(200_000, 0, { text: '加粗', value: '加粗', styleId: 's-bold' });
    });
    expect(source.getCellCount()).toBe(1_200_001);

    const buf = exportXlsxBuffer(source);
    const restored = Store.deserialize(importXlsx(buf));
    expect(restored.getCellCount()).toBe(1_200_001);
    expect(restored.getCell(0, 0)?.value).toBe(1);
    expect(restored.getCell(119_999, 9)?.value).toBe(1);
    const far = restored.getCell(200_000, 0);
    expect(far?.text).toBe('加粗');
    expect(restored.getStyle(far?.styleId ?? '')?.bold).toBe(true);
  }, 240_000);

  it('imports a 200k-line CSV through CsvImportPlugin within seconds', () => {
    const lines: string[] = [];
    for (let i = 0; i < 200_000; i += 1) lines.push(`${i},甲${i},乙${i}`);
    const csv = lines.join('\n');

    const store = new Store();
    const host: PluginHost = {
      store,
      cmdManager: {} as unknown as CommandManager,
      events: new EventBus(),
      formula: {} as unknown as FormulaEngine,
    };
    new PluginManager(host).use(CsvImportPlugin);

    const t0 = performance.now();
    host.events.emit('csv:import', csv);
    const ms = performance.now() - t0;

    expect(store.getCellCount()).toBe(600_000);
    expect(store.getCell(0, 0)?.text).toBe('0');
    expect(store.getCell(123_456, 1)?.text).toBe('甲123456');
    expect(store.getCell(199_999, 2)?.text).toBe('乙199999');
    expect(ms).toBeLessThan(CSV_IMPORT_MS);
  });
});
