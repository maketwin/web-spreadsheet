import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Store } from '../../src/store/Store';
import { CommandManager } from '../../src/commands/CommandManager';
import { SetCellText } from '../../src/commands/impl/SetCellText';
import { FormulaEngine } from '../../src/formula/FormulaEngine';
import { createFormulaSync } from '../../src/formula/formulaSync';
import { recorder, report, rng } from './harness';

/**
 * Experiment 3 — formulas at scale: a hundred thousand row formulas, a
 * hundred-thousand-cell dependency chain, aggregates over a million-cell
 * range (bounded and whole-column), a lookup into a million-row table, and
 * whole-column sums across fifty sheets.
 */
const MILLION = 1_000_000;
const HUNDRED_THOUSAND = 100_000;

/** Target is what we aim for; the test fails only beyond ten times it. */
function within(sample: { label: string; ms: number }, targetMs: number): void {
  if (sample.ms <= targetMs * 10) return;
  throw new Error(`${sample.label}: ${sample.ms.toFixed(0)} ms is more than 10x the ${targetMs} ms target`);
}

/** A workbook with its formula engine attached the way the UI attaches it. */
function open(): { store: Store; engine: FormulaEngine; cm: CommandManager; detach: () => void } {
  const store = new Store();
  const engine = new FormulaEngine(store);
  const sync = createFormulaSync(store, engine);
  return { store, engine, cm: new CommandManager(store), detach: () => sync.unsubscribe() };
}

type App = ReturnType<typeof open>;

/** Types formulas down column `c` through the command bus, one per row from `from`, inside one batch. */
function enter(app: App, c: number, from: number, count: number, text: (r: number) => string): void {
  const run = app.cm.execute.bind(app.cm);
  app.store.batch(() => {
    for (let r = from; r < from + count; r += 1) run(new SetCellText({ r, c, text: text(r) }));
  });
}

function put(app: App, r: number, c: number, text: string): void {
  app.cm.execute.bind(app.cm)(new SetCellText({ r, c, text }));
}

function column(app: App, c: number, rows: number): number[] {
  const out: number[] = [];
  for (let r = 0; r < rows; r += 1) out.push(app.store.getCell(r, c)?.value as number);
  return out;
}

describe('scale: formulas', () => {
  const rec = recorder();

  it('one hundred thousand row formulas', () => {
    const app = open();
    const random = rng(7);
    app.store.batch(() => {
      for (let r = 0; r < HUNDRED_THOUSAND; r += 1) { const v = Math.floor(random() * 1000); app.store.setCell(r, 0, { text: String(v), value: v }); }
    });
    rec.time('enter 100,000 formulas =A{r}*2', () => enter(app, 1, 0, HUNDRED_THOUSAND, (r) => `=A${r + 1}*2`));
    within(rec.samples.at(-1)!, 4_000);
    const inputs = column(app, 0, HUNDRED_THOUSAND);
    const outputs = column(app, 1, HUNDRED_THOUSAND);
    expect(outputs[0]).toBe(inputs[0]! * 2);
    expect(outputs[HUNDRED_THOUSAND - 1]).toBe(inputs[HUNDRED_THOUSAND - 1]! * 2);
    rec.time('recalculate all 100,000', () => app.engine.recalculateAll());
    within(rec.samples.at(-1)!, 2_000);
    const before = outputs.reduce((a, b) => a + b, 0);
    rec.time('edit one input: its one dependent recalculates', () => put(app, 50_000, 0, String(inputs[50_000]! + 1)));
    within(rec.samples.at(-1)!, 30);
    expect(column(app, 1, HUNDRED_THOUSAND).reduce((a, b) => a + b, 0)).toBe(before + 2);
    app.detach();
  });

  it('a hundred-thousand-cell dependency chain', () => {
    const app = open();
    put(app, 0, 2, '1');
    rec.time('enter 99,999 chained formulas =C{r-1}+1', () => enter(app, 2, 1, HUNDRED_THOUSAND - 1, (r) => `=C${r}+1`));
    within(rec.samples.at(-1)!, 10_000);
    expect(app.store.getCell(HUNDRED_THOUSAND - 1, 2)?.value).toBe(HUNDRED_THOUSAND);
    rec.time('edit the head of the chain: all 99,999 recompute', () => put(app, 0, 2, '5'));
    within(rec.samples.at(-1)!, 10_000);
    expect(app.store.getCell(HUNDRED_THOUSAND - 1, 2)?.value).toBe(HUNDRED_THOUSAND + 4);
    app.detach();
  });

  it('aggregates over a million-cell range', () => {
    const app = open();
    app.store.batch(() => {
      for (let r = 0; r < MILLION; r += 1) app.store.setCell(r, 0, { text: String(r + 1), value: r + 1 });
    });
    const total = (MILLION * (MILLION + 1)) / 2;
    rec.time('enter =SUM(A1:A1048576) over 1,000,000 numbers', () => put(app, 0, 3, '=SUM(A1:A1048576)'));
    within(rec.samples.at(-1)!, 300);
    expect(app.store.getCell(0, 3)?.value).toBe(total);
    rec.time('enter =SUM(A:A) (whole-column reference)', () => put(app, 1, 3, '=SUM(A:A)'));
    within(rec.samples.at(-1)!, 300);
    expect(app.store.getCell(1, 3)?.value).toBe(total);
    for (const [r, text] of [
      [2, '=COUNT(A1:A1048576)'],
      [3, '=AVERAGE(A:A)'],
      [4, '=MAX(A1:A1048576)'],
      [5, '=MIN(A1:A1048576)'],
      [6, '=SUMIF(A1:A1048576, ">500000")'],
      [7, '=COUNTBLANK(A1:A1048576)'],
      [8, '=MEDIAN(A1:A100001)'],
    ] as const) {
      rec.time(`enter ${text}`, () => put(app, r, 3, text));
      within(rec.samples.at(-1)!, 500);
    }
    expect(app.store.getCell(2, 3)?.value).toBe(MILLION);
    expect(app.store.getCell(3, 3)?.value).toBe((MILLION + 1) / 2);
    expect(app.store.getCell(4, 3)?.value).toBe(MILLION);
    expect(app.store.getCell(5, 3)?.value).toBe(1);
    expect(app.store.getCell(7, 3)?.value).toBe(48_576);
    expect(app.store.getCell(8, 3)?.value).toBe(50_001);
    const sumIf = app.store.getCell(6, 3)?.value as number;
    expect(sumIf).toBe(total - (500_000 * 500_001) / 2);
    rec.time('edit one number in the range: every aggregate recomputes', () => put(app, 250_000, 0, '0'));
    within(rec.samples.at(-1)!, 3_000);
    expect(app.store.getCell(0, 3)?.value).toBe(total - 250_001);
    app.detach();
  });

  it('looks up in a million-row table', () => {
    const app = open();
    app.store.batch(() => {
      for (let r = 0; r < MILLION; r += 1) {
        app.store.setCell(r, 1, { text: String(r + 1), value: r + 1 });
        app.store.setCell(r, 2, { text: String((r + 1) * 10), value: (r + 1) * 10 });
      }
    });
    rec.time('enter =VLOOKUP(999999, B1:C1048576, 2, FALSE) — exact, last rows', () => put(app, 0, 5, '=VLOOKUP(999999, B1:C1048576, 2, FALSE)'));
    within(rec.samples.at(-1)!, 3_000);
    expect(app.store.getCell(0, 5)?.value).toBe(9_999_990);
    rec.time('enter =VLOOKUP(500000, B:C, 2) — approximate, whole columns', () => put(app, 1, 5, '=VLOOKUP(500000, B:C, 2)'));
    within(rec.samples.at(-1)!, 1_000);
    expect(app.store.getCell(1, 5)?.value).toBe(5_000_000);
    rec.time('enter =MATCH(777777, A1:A1048576, 0) over the key column', () => put(app, 2, 5, '=MATCH(777777, B1:B1048576, 0)'));
    within(rec.samples.at(-1)!, 3_000);
    expect(app.store.getCell(2, 5)?.value).toBe(777_777);
    app.detach();
  });

  it('whole-column sums across fifty sheets', () => {
    const app = open();
    rec.time('50 sheets x 20,000 numbers', () => {
      app.store.batch(() => {
        for (let s = 0; s < 50; s += 1) {
          const id = app.store.addSheet(`Data${s + 1}`);
          for (let r = 0; r < 20_000; r += 1) app.store.setCell(r, 0, { text: String(r + 1), value: r + 1 }, id);
        }
      });
    });
    within(rec.samples.at(-1)!, 4_000);
    const summary = app.store.addSheet('Summary');
    rec.time('50 cross-sheet =SUM(DataK!A:A) + grand total', () => {
      app.store.batch(() => {
        for (let s = 0; s < 50; s += 1) put(app, s, 0, `=SUM(Data${s + 1}!A:A)`);
        put(app, 50, 0, '=SUM(A1:A50)');
      });
      void summary;
    });
    within(rec.samples.at(-1)!, 3_000);
    const perSheet = (20_000 * 20_001) / 2;
    expect(app.store.getCell(0, 0, summary)?.value).toBe(perSheet);
    expect(app.store.getCell(50, 0, summary)?.value).toBe(perSheet * 50);
    const data25 = app.store.getSheets().find((s) => s.name === 'Data25')!.id;
    rec.time('edit one number on Data25: its sheet sum and the grand total follow', () => put2(app, data25, 7, 0, '0'));
    within(rec.samples.at(-1)!, 1_500);
    expect(app.store.getCell(24, 0, summary)?.value).toBe(perSheet - 8);
    expect(app.store.getCell(50, 0, summary)?.value).toBe(perSheet * 50 - 8);
    app.detach();
  });

  it('prints the results', () => {
    const samples = report('experiment 3 · formulas', rec);
    mkdirSync('coverage/scale-bench', { recursive: true });
    writeFileSync('coverage/scale-bench/formulas.json', JSON.stringify(samples, null, 2));
  });
});

function put2(app: App, sheetId: string, r: number, c: number, text: string): void {
  app.cm.execute.bind(app.cm)(new SetCellText({ r, c, text, sheetId }));
}
