import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Store } from '../../src/store/Store';
import { CommandManager } from '../../src/commands/CommandManager';
import { SetCellText } from '../../src/commands/impl/SetCellText';
import { InsertRowCommand } from '../../src/commands/impl/InsertRow';
import { FormulaEngine } from '../../src/formula/FormulaEngine';
import { createFormulaSync } from '../../src/formula/formulaSync';
import { recorder, report, rng } from './harness';

/**
 * Experiment 2 — many sheets with real data and formulas between them:
 * N sheets of R rows x 4 numeric columns, a per-row SUM in column E and a
 * sheet total, plus one summary sheet whose cells SUM into every other sheet.
 * Two shapes with the same one million numbers: 50 fat sheets and 200 thin ones.
 */
const WORKBOOKS = [
  { name: '50 sheets x 20,000 numbers (2,000 rows)', sheets: 50, rows: 2_000 },
  { name: '200 sheets x 5,000 numbers (1,250 rows)', sheets: 200, rows: 1_250 },
] as const;

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

describe.each(WORKBOOKS)('scale: $name', (wb) => {
  const rec = recorder();
  const app = open();
  let totalNumbers = 0;

  it('builds the data sheet by sheet', () => {
    const random = rng(11_25);
    rec.time(`create ${wb.sheets} sheets and fill them (batched)`, () => {
      store_batch_fill();
    });
    function store_batch_fill(): void {
      app.store.batch(() => {
        for (let s = 0; s < wb.sheets; s += 1) {
          const id = app.store.addSheet(`Data${s + 1}`);
          for (let r = 0; r < wb.rows; r += 1) {
            for (let c = 0; c < 4; c += 1) {
              const v = Math.floor(random() * 10_000);
              app.store.setCell(r, c, { text: String(v), value: v }, id);
            }
          }
        }
      });
    }
    totalNumbers = wb.sheets * wb.rows * 4;
    expect(app.store.getSheets()).toHaveLength(wb.sheets + 1);
    within(rec.samples.at(-1)!, 6_000);
  });

  it('enters the formulas', () => {
    const run = app.cm.execute.bind(app.cm);
    const dataSheets = app.store.getSheets().filter((s) => s.name.startsWith('Data'));
    rec.time('one SUM per data row (formulas typed through the command bus, batched)', () => {
      app.store.batch(() => {
        for (const { id } of dataSheets) {
          for (let r = 0; r < wb.rows; r += 1) {
            const f = `=SUM(A${r + 1}:D${r + 1})`;
            run(new SetCellText({ r, c: 4, text: f, sheetId: id }));
          }
        }
      });
    });
    within(rec.samples.at(-1)!, Math.max(4_000, wb.sheets * 250));
    const formulas = wb.sheets * wb.rows;
    expect(app.engine.registry.has('SUM')).toBe(true);
    expect(app.store.getCell(0, 4, dataSheets[0]!.id)?.value).toBeGreaterThan(0);
    rec.time('recalculate every formula', () => app.engine.recalculateAll());
    within(rec.samples.at(-1)!, Math.max(4_000, formulas / 60));
    app.cm.clear();
  });

  it('sums the sheets from a summary sheet', () => {
    const run = app.cm.execute.bind(app.cm);
    const dataSheets = app.store.getSheets().filter((s) => s.name.startsWith('Data'));
    const summary = app.store.addSheet('Summary');
    rec.time(`${wb.sheets} cross-sheet SUMs + a grand total`, () => {
      app.store.batch(() => {
        dataSheets.forEach(({ name }, k) => {
          run(new SetCellText({ r: k, c: 0, text: name, sheetId: summary }));
          run(new SetCellText({ r: k, c: 1, text: `=SUM(${name}!E1:E${wb.rows})`, sheetId: summary }));
        });
        run(new SetCellText({ r: dataSheets.length, c: 0, text: 'Total', sheetId: summary }));
        run(new SetCellText({ r: dataSheets.length, c: 1, text: `=SUM(B1:B${dataSheets.length})`, sheetId: summary }));
      });
    });
    within(rec.samples.at(-1)!, 3_000);
    const grand = app.store.getCell(dataSheets.length, 1, summary)?.value;
    expect(typeof grand).toBe('number');
    expect(grand).toBeGreaterThan(0);
    const first = app.store.getCell(0, 1, summary)?.value;
    // Editing one number in the first data sheet moves its sheet total and the grand total.
    rec.time('edit one number: sheet total and grand total follow', () => {
      run(new SetCellText({ r: 0, c: 0, text: '1', sheetId: dataSheets[0]!.id }));
    });
    within(rec.samples.at(-1)!, 60);
    expect(app.store.getCell(0, 1, summary)?.value).not.toBe(first);
    expect(app.store.getCell(0, 4, dataSheets[0]!.id)?.value).toBe(
      (app.store.getCell(0, 1, summary)?.value as number) - sumBelow(wb.rows),
    );
    app.cm.clear();
    app.store.activateSheet(summary);
  });

  /** The per-sheet total is `SUM(E1:E{rows})`; the summary adds those up, so this is the part of the first sheet's total below its first row. */
  function sumBelow(rows: number): number {
    const id = app.store.getSheets().find((s) => s.name === 'Data1')!.id;
    let sum = 0;
    for (let r = 1; r < rows; r += 1) sum += app.store.getCell(r, 4, id)?.value as number;
    return sum;
  }

  it('saves, reloads and reopens', () => {
    const serialized = rec.time('serialize the whole workbook', () => app.store.serialize());
    within(rec.samples.at(-1)!, 800);
    rec.time('Store.deserialize', () => Store.deserialize(serialized));
    within(rec.samples.at(-1)!, 2_500);
    // The load path the UI uses on restore: a live store, an attached engine, replaceAll.
    const fresh = open();
    rec.time('replaceAll on a store with the formula engine attached', () => fresh.store.replaceAll(serialized));
    within(rec.samples.at(-1)!, 6_000);
    expect(fresh.store.getSheets()).toHaveLength(wb.sheets + 2);
    const dataSheets = fresh.store.getSheets().filter((s) => s.name.startsWith('Data'));
    expect(fresh.store.getCell(0, 4, dataSheets[0]!.id)?.value).toBeGreaterThan(0);
    expect(fresh.store.getCell(wb.sheets, 1, fresh.store.getSheets().at(-1)!.id)?.value).toBeGreaterThan(0);
    rec.time('switch to another sheet (store.activateSheet)', () => fresh.store.activateSheet(dataSheets[Math.floor(wb.sheets / 2)]!.id));
    within(rec.samples.at(-1)!, 5);
    // A structural edit inside one data sheet: its 2,000 row formulas and the
    // summary's reference to it move, then move back.
    const edited = dataSheets[Math.floor(wb.sheets / 2)]!.id;
    const summaryId = fresh.store.getSheets().at(-1)!.id;
    const run = fresh.cm.execute.bind(fresh.cm);
    const sheetTotalBefore = fresh.store.getCell(0, 1, summaryId)?.value;
    rec.time('insert a row at the top of one data sheet (its formulas and the summary reference move)', () => {
      run(new InsertRowCommand({ r: 0, sheetId: edited }));
    });
    within(rec.samples.at(-1)!, 100);
    expect(fresh.store.getCell(1, 4, edited)?.value).toBeGreaterThan(0);
    expect(fresh.store.getCell(0, 1, summaryId)?.value).toBe(sheetTotalBefore);
    rec.time('… undo', () => fresh.cm.undo());
    within(rec.samples.at(-1)!, 100);
    expect(fresh.store.getCell(0, 4, edited)?.value).toBeGreaterThan(0);
    expect(fresh.store.getCell(0, 1, summaryId)?.value).toBe(sheetTotalBefore);
    rec.time('copy a data sheet', () => {
      const copy = fresh.store.copySheet(dataSheets[3]!.id, { name: 'CopyOf4' });
      if (copy !== undefined) fresh.store.deleteSheet(copy);
    });
    within(rec.samples.at(-1)!, 400);
    fresh.detach();
    app.detach();
  });

  it('prints the results', () => {
    const samples = report(`experiment 2 · ${wb.name} · ${totalNumbers.toLocaleString('en-US')} numbers, ${wb.sheets * wb.rows + wb.sheets + 1} formulas`, rec);
    mkdirSync('coverage/scale-bench', { recursive: true });
    writeFileSync(`coverage/scale-bench/sheets-${wb.sheets}.json`, JSON.stringify(samples, null, 2));
  });
});
