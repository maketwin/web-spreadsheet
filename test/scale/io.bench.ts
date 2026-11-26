import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';
import { exportXlsxBuffer } from '../../src/io/XlsxExporter';
import { importXlsx } from '../../src/io/XlsxImporter';
import { exportCsv } from '../../src/io/CsvExporter';
import { Store } from '../../src/store/Store';
import { TOTAL_COLS, TOTAL_ROWS } from '../../src/util/gridSize';
import { recorder, report, rng, within, type Recorder } from './harness';

/**
 * Experiment 2 — import/export at the million-cell scale. The grid is Excel's
 * whole address space, so io must cost what is stored, never what the used
 * rectangle happens to span: the far-apart shapes below pin the packed-export
 * path, the million-cell shapes pin the plain one.
 *
 * Run `pnpm bench:scale -- test/scale/io.bench.ts` and read the table; the
 * assertions only fail on a catastrophic regression (ten times the target).
 * `metrics` (written alongside the samples into coverage/scale-bench/io.json)
 * carries the non-time numbers: exported file bytes and peak RSS around the
 * big imports.
 */
const BENCH_JSON = 'coverage/scale-bench/io.json';

const ROWS = 100_000;
const COLS = 10;
const SHEETS = 50;
const DIAGONAL = 2_000;

const rssMb = (): number => Math.round(process.memoryUsage().rss / 1e6);

const rec = recorder();
const metrics: Record<string, number> = {};

function metricsTime(label: string, fn: () => ArrayBuffer): ArrayBuffer {
  const buf = rec.time(label, () => fn());
  metrics[`${label} · bytes`] = buf.byteLength;
  return buf;
}

/** The same deterministic numbers in every scenario that wants a dense block. */
function fillNumbers(store: Store, rows: number, cols: number, decorate?: (r: number, c: number) => { styleId?: string }): void {
  const random = rng(20261125);
  store.batch(() => {
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const v = Math.floor(random() * 1_000_000);
        store.setCell(r, c, { text: String(v), value: v, ...decorate?.(r, c) });
      }
    }
  });
}

describe('io bench', () => {
  it('dense block 100,000 x 10: export xlsx / import xlsx / export csv', () => {
    const store = new Store();
    rec.time('fill 1,000,000 numbers', () => fillNumbers(store, ROWS, COLS));
    // Axis metadata rides along so the export's <cols>/<row> writing and the
    // round trip stay asserted at scale (not timed; the metadata is tiny).
    store.setCol(0, { width: 120 });
    store.setCol(9, { width: 90 });
    store.setRow(0, { height: 28 });

    const buf = metricsTime('export xlsx (100,000x10 numbers)', () => exportXlsxBuffer(store));
    within(rec.samples.at(-1)!, 3_000);
    // The package really carries the axis parts: an unpacked XML check.
    const sheetXml = strFromU8(unzipSync(new Uint8Array(buf))['xl/worksheets/sheet1.xml']!);
    expect(sheetXml.indexOf('<cols>')).toBeGreaterThan(-1);
    expect(sheetXml).toContain('<col min="1" max="1" width="16.43" customWidth="1"/>');
    expect(sheetXml).toContain('<col min="10" max="10" width="12.14" customWidth="1"/>');
    expect(sheetXml).toContain('<row r="1" ht="21" customHeight="1">');
    const rssBefore = rssMb();
    const imported = rec.time('import xlsx (100,000x10 numbers)', () => importXlsx(buf));
    metrics['import xlsx (100,000x10 numbers) · peak rss MB'] = rssMb();
    metrics['import xlsx (100,000x10 numbers) · rss before MB'] = rssBefore;
    within(rec.samples.at(-1)!, 2_000);
    const sheet = imported.sheets[0]!;
    expect(sheet.data.cells.length).toBe(ROWS * COLS);
    // Widths and heights survive the round trip.
    expect(new Map(sheet.data.cols).get(0)).toEqual({ width: 120 });
    expect(new Map(sheet.data.cols).get(9)).toEqual({ width: 90 });
    expect(new Map(sheet.data.rows).get(0)).toEqual({ height: 28 });

    const csv = rec.time('export csv (100,000x10 numbers)', () => exportCsv(store));
    metrics['export csv (100,000x10 numbers) · chars'] = csv.length;
    within(rec.samples.at(-1)!, 2_000);
    expect(csv.split('\r\n').length).toBe(ROWS);
  });

  it('styled block 100,000 x 10 + K-column formulas: export / import', () => {
    const store = new Store();
    store.setStyle('s-bold', { bold: true });
    store.setStyle('s-nf', { numberFormat: '#,##0.00' });
    rec.time('fill 1,100,000 styled cells + formulas', () => {
      fillNumbers(store, ROWS, COLS, (r, c) => ({ styleId: (r + c) % 2 === 0 ? 's-bold' : 's-nf' }));
      store.batch(() => {
        for (let r = 0; r < ROWS; r += 1) {
          store.setCell(r, COLS, { formula: `=A${r + 1}+1`, text: '1', value: 1 });
        }
      });
    });

    const buf = metricsTime('export xlsx (styled + formulas)', () => exportXlsxBuffer(store));
    within(rec.samples.at(-1)!, 5_000);
    const imported = rec.time('import xlsx (styled + formulas)', () => importXlsx(buf));
    within(rec.samples.at(-1)!, 3_000);

    const sheet = imported.sheets[0]!;
    const cells = new Map(sheet.data.cells);
    expect(cells.size).toBe(ROWS * (COLS + 1));
    // Every flavor reads back: plain number, both styles, the formula.
    expect(cells.get('0,0')?.styleId).toBeDefined();
    expect(cells.get(`${ROWS - 1},${COLS}`)?.formula).toBe(`=A${ROWS}+1`);
    const styleOf = (r: number, c: number) => {
      const id = cells.get(`${r},${c}`)?.styleId;
      return id === undefined ? undefined : sheet.data.styles.find(([styleId]) => styleId === id)?.[1];
    };
    expect(styleOf(0, 0)?.bold).toBe(true);
    expect(styleOf(0, 0)?.numberFormat).toBeUndefined();
    expect(styleOf(0, 1)?.numberFormat).toBe('number');
    expect(styleOf(0, 1)?.bold).toBeUndefined();
    expect(styleOf(1, 0)?.bold).toBeUndefined(); // (1+0)%2 === 1 → nf, not bold
    expect(styleOf(1, 1)?.bold).toBe(true);
  });

  it('50 sheets x 2,000 x 10: export / import', () => {
    const store = new Store();
    const ids: string[] = [store.getSheets()[0]!.id];
    while (ids.length < SHEETS) ids.push(store.addSheet(`S${ids.length + 1}`));
    rec.time(`fill ${SHEETS * 20_000} numbers over ${SHEETS} sheets`, () => {
      store.batch(() => {
        for (const id of ids) fillNumbersInto(store, id);
      });
    });

    const buf = metricsTime(`export xlsx (${SHEETS} sheets)`, () => exportXlsxBuffer(store));
    within(rec.samples.at(-1)!, 5_000);
    const imported = rec.time(`import xlsx (${SHEETS} sheets)`, () => importXlsx(buf));
    within(rec.samples.at(-1)!, 3_000);
    expect(imported.sheets.length).toBe(SHEETS);
    expect(imported.sheets.reduce((n, sheet) => n + sheet.data.cells.length, 0)).toBe(SHEETS * 20_000);
  });

  it('far shapes: A1 + XFD1048576 (packed export path)', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'top', value: 'top' });
    store.setCell(TOTAL_ROWS - 1, TOTAL_COLS - 1, { text: 'corner', value: 'corner' });

    const buf = metricsTime('export A1 + XFD1048576 (packed)', () => exportXlsxBuffer(store));
    within(rec.samples.at(-1)!, 10); // ceiling 100 ms; a dense walk here is hours
    const restored = Store.deserialize(rec.time('import A1 + XFD1048576', () => importXlsx(buf)));
    within(rec.samples.at(-1)!, 100);
    expect(restored.getCellCount()).toBe(2);
    expect(restored.getCell(0, 0)?.value).toBe('top');
    expect(restored.getCell(TOTAL_ROWS - 1, TOTAL_COLS - 1)?.value).toBe('corner');
    expect(restored.getUsedBounds()).toEqual({ r1: 0, c1: 0, r2: TOTAL_ROWS - 1, c2: TOTAL_COLS - 1 });
  });

  it('far shapes: A1 + XFD1000', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'top', value: 'top' });
    store.setCell(999, TOTAL_COLS - 1, { text: 'far', value: 'far' });

    const buf = metricsTime('export A1 + XFD1000 (packed)', () => exportXlsxBuffer(store));
    within(rec.samples.at(-1)!, 30); // ceiling 300 ms
    const restored = Store.deserialize(rec.time('import A1 + XFD1000', () => importXlsx(buf)));
    within(rec.samples.at(-1)!, 100);
    expect(restored.getCellCount()).toBe(2);
    expect(restored.getCell(999, TOTAL_COLS - 1)?.value).toBe('far');
  });

  it('far shapes: 2,000 diagonal cells (i, i*8)', () => {
    const store = new Store();
    store.batch(() => {
      for (let i = 0; i < DIAGONAL; i += 1) store.setCell(i, i * 8, { text: String(i), value: i });
    });

    const buf = metricsTime('export 2,000-cell diagonal (packed)', () => exportXlsxBuffer(store));
    within(rec.samples.at(-1)!, 100); // ceiling 1 s; the used rectangle is ~32M addresses
    const restored = Store.deserialize(rec.time('import 2,000-cell diagonal', () => importXlsx(buf)));
    within(rec.samples.at(-1)!, 100);
    expect(restored.getCellCount()).toBe(DIAGONAL);
    expect(restored.getCell(0, 0)?.value).toBe(0);
    expect(restored.getCell(DIAGONAL - 1, (DIAGONAL - 1) * 8)?.value).toBe(DIAGONAL - 1);
  });

  it('one column of 1,000,000 numbers: export / import (regression)', () => {
    const store = new Store();
    rec.time('fill 1,000,000x1 numbers', () => fillNumbers(store, 1_000_000, 1));

    const rssBefore = rssMb();
    const buf = metricsTime('export xlsx (1,000,000x1 numbers)', () => exportXlsxBuffer(store));
    within(rec.samples.at(-1)!, 3_000);
    const imported = rec.time('import xlsx (1,000,000x1 numbers)', () => importXlsx(buf));
    metrics['import xlsx (1,000,000x1 numbers) · peak rss MB'] = rssMb();
    metrics['import xlsx (1,000,000x1 numbers) · rss before MB'] = rssBefore;
    within(rec.samples.at(-1)!, 3_000);
    const sheet = imported.sheets[0]!;
    expect(sheet.data.cells.length).toBe(1_000_000);
    expect(sheet.data.cells[0]![0]).toBe('0,0');
    expect(sheet.data.cells.at(-1)?.[0]).toBe('999999,0');
  });

  it('prints the results', () => {
    const samples = report('experiment 2 · io at million-cell scale', rec as Recorder);
    mkdirSync('coverage/scale-bench', { recursive: true });
    writeFileSync(BENCH_JSON, JSON.stringify({ samples, metrics }, null, 2));
  });
});

/** 2,000 x 10 block of deterministic numbers into one sheet. */
function fillNumbersInto(store: Store, sheetId: string): void {
  const random = rng(20261125);
  for (let r = 0; r < 2_000; r += 1) {
    for (let c = 0; c < 10; c += 1) {
      const v = Math.floor(random() * 1_000_000);
      store.setCell(r, c, { text: String(v), value: v }, sheetId);
    }
  }
}
