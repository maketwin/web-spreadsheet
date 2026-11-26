import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { Store as StoreClass } from '../src/store/Store';

/**
 * Scale experiment in a real browser (`pnpm e2e:scale`, its own Playwright
 * config; it is not part of `pnpm e2e`): a million
 * cells and dozens of sheets in the demo page, measuring what a user feels —
 * time until the sheet is on screen after loading it, the longest stretch the
 * main thread stays blocked while scrolling, selecting, editing, inserting a
 * row, switching sheets, formatting a whole column, and while the auto-save of
 * a large workbook runs. The table this prints is the result; assertions only
 * fail on a catastrophic regression.
 */

interface Sample { label: string; ms: number; note?: string | undefined }
const samples: Sample[] = [];
const record = (label: string, ms: number, note?: string): void => { samples.push({ label, ms, note }); };
const ceiling = (label: string, ms: number, limit: number): void => {
  if (ms <= limit) return;
  throw new Error(`${label}: ${ms.toFixed(0)} ms exceeds the ${limit} ms ceiling`);
};

/** Frame logger: every animation-frame timestamp, so the longest gap between two marks is the main thread's longest block. */
async function startFrameLogger(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __frameStop: boolean };
    w.__frames = [];
    w.__frameStop = false;
    const tick = (t: number): void => {
      if (w.__frameStop) return;
      w.__frames.push(t);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function mark(page: Page, name: string): Promise<void> {
  await page.evaluate((n) => { performance.mark(n); }, name);
}

/** Longest gap between consecutive frames whose timestamps lie in [from, to] (performance.mark names). */
async function longestBlock(page: Page, from: string, to: string): Promise<number> {
  return page.evaluate(([a, b]) => {
    const w = window as unknown as { __frames: number[] };
    const start = performance.getEntriesByName(a)[0]?.startTime ?? 0;
    const end = performance.getEntriesByName(b).at(-1)?.startTime ?? Infinity;
    let longest = 0;
    let previous = start;
    for (const t of w.__frames) {
      if (t < start || t > end) continue;
      longest = Math.max(longest, t - previous);
      previous = t;
    }
    return longest;
  }, [from, to] as const);
}

const frames = (page: Page, n: number): Promise<unknown> => page.evaluate((count) => new Promise((resolve) => {
  let left = count;
  const step = (): void => { left -= 1; if (left <= 0) resolve(undefined); else requestAnimationFrame(step); };
  requestAnimationFrame(step);
}), n);

/** A serialized workbook: `sheets` data sheets of `rows` x `cols` numbers, the last cell a SUM of its row. */
function workbook(sheets: number, rows: number, cols: number): string {
  const out: string[] = ['{"activeSheetId":"sheet-1","sheets":['];
  for (let s = 0; s < sheets; s += 1) {
    const cells: string[] = [];
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) cells.push(`["${r},${c}",{"text":"${r * cols + c}","value":${r * cols + c}}]`);
    }
    if (s > 0) out.push(',');
    out.push(`{"id":"sheet-${s + 1}","name":"Sheet${s + 1}","data":{"cells":[${cells.join(',')}],"rows":[],"cols":[],"styles":[],"merges":[],"conditionalRules":[],"charts":[],"images":[],"validationRules":[],"sparklines":[],"namedRanges":[],"rowGroups":[]}}`);
  }
  out.push(']}');
  return out.join('');
}

async function load(page: Page, json: string): Promise<void> {
  // The dev server serves the app's own module instance; the path is a variable so the type checker does not try to resolve it.
  await page.evaluate(async (text) => {
    const modulePath = '/src/store/Store.ts';
    const { Store } = (await import(/* @vite-ignore */ modulePath)) as { Store: typeof StoreClass };
    const data = JSON.parse(text);
    const store = window.__ss.store;
    const t0 = performance.now();
    store.replaceAll(Store.deserialize(data).serialize());
    (window as unknown as { __loadMs: number }).__loadMs = performance.now() - t0;
  }, json);
}

async function openPage(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForSelector('canvas.ss-canvas');
  await page.waitForFunction(() => window.__ss?.store !== undefined);
  await frames(page, 5);
}

test.describe('scale in a real browser', () => {
  test.setTimeout(900_000);

  test('one sheet with a million cells', async ({ page }) => {
    await openPage(page);
    const json = workbook(1, 100_000, 10);
    await mark(page, 'load-start');
    const t0 = Date.now();
    await load(page, json);
    await frames(page, 3);
    const openMs = Date.now() - t0;
    const cells = await page.evaluate(() => window.__ss.store.getCellCount());
    record('open a 100,000 x 10 workbook (replaceAll → on screen)', openMs, `${cells} cells`);
    ceiling('open', openMs, 15_000);
    await mark(page, 'load-end');
    await startFrameLogger(page);

    // Scroll through the sheet with the wheel: 30 bursts of 10 ticks.
    await mark(page, 'scroll-start');
    const canvas = page.locator('canvas.ss-canvas');
    const box = await canvas.boundingBox();
    for (let i = 0; i < 30; i += 1) {
      await page.mouse.move(box!.x + 400, box!.y + 300);
      await page.mouse.wheel(0, 600);
    }
    await frames(page, 5);
    await mark(page, 'scroll-end');
    const scrollBlock = await longestBlock(page, 'scroll-start', 'scroll-end');
    record('longest main-thread block while scrolling 300 wheel ticks', scrollBlock);
    ceiling('scroll', scrollBlock, 400);

    // Jump to the last cell of the address space through the name box.
    const nameBox = page.locator('input[aria-label="Selected cell"]');
    await nameBox.click();
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await mark(page, 'jump-start');
    await nameBox.fill('XFD1048576');
    await page.keyboard.press('Enter');
    await frames(page, 5);
    await mark(page, 'jump-end');
    record('longest block: jump to XFD1048576', await longestBlock(page, 'jump-start', 'jump-end'));
    expect(await nameBox.inputValue()).toBe('XFD1048576');

    // Type into the last cell.
    await mark(page, 'type-start');
    await page.keyboard.type('42');
    await page.keyboard.press('Enter');
    await frames(page, 5);
    await mark(page, 'type-end');
    record('longest block: type a value at XFD1048576 and commit', await longestBlock(page, 'type-start', 'type-end'));
    expect(await page.evaluate(() => window.__ss.store.getCell(1_048_575, 16_383)?.value)).toBe(42);

    // Select a column by its header and bold it from the toolbar.
    await nameBox.click();
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await mark(page, 'select-start');
    await nameBox.fill('A1');
    await page.keyboard.press('Enter');
    await frames(page, 3);
    await mark(page, 'select-end');
    record('longest block: jump back to A1', await longestBlock(page, 'select-start', 'select-end'));

    await page.evaluate(() => window.__ss.store.activateSheet('sheet-1'));
    await frames(page, 3);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await mark(page, 'bold-start');
    await nameBox.fill('A:A');
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Bold', exact: true }).click();
    await frames(page, 5);
    await mark(page, 'bold-end');
    record('longest block: select column A and make it bold', await longestBlock(page, 'bold-start', 'bold-end'));
    // Whole-column formatting is the column's default: the cells keep no style of their own.
    expect(await page.evaluate(() => window.__ss.store.getCellStyle(99_999, 0)?.bold)).toBe(true);

    // Insert a row through the row header's context menu, then undo it. The
    // header click selects that row, so the name box tells which one was hit.
    // (Typed into the name box, `A:A` now keeps the view where it was — its
    // active cell is A1 — but the step states where it starts regardless.)
    expect(await page.evaluate(() => { const w = window as unknown as { __ss: { store: { getCellStyle(r: number, c: number): { bold?: boolean } | undefined } } }; return w.__ss.store.getCellStyle(0, 0)?.bold; })).toBe(true);
    await nameBox.click();
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await nameBox.fill('A1');
    await page.keyboard.press('Enter');
    await frames(page, 3);
    const canvasBox = await canvas.boundingBox();
    await mark(page, 'insert-start');
    await page.mouse.click(canvasBox!.x + 20, canvasBox!.y + 80, { button: 'right' });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const headerRow = Number((await nameBox.inputValue()).match(/\d+/)?.[0]) - 1;
    expect(headerRow).toBeGreaterThanOrEqual(0);
    expect(headerRow).toBeLessThan(100_000); // inside the data block
    await page.getByRole('menuitem', { name: '插入', exact: true }).click();
    await frames(page, 5);
    await mark(page, 'insert-end');
    expect(await page.evaluate((r) => window.__ss.store.getCell(r, 0), headerRow)).toBeUndefined();
    expect(await page.evaluate((r) => window.__ss.store.getCell(r, 0)?.value, headerRow + 1)).toBe(headerRow * 10);
    record('longest block: insert a row above row ' + (headerRow + 1) + ' (row-header menu)', await longestBlock(page, 'insert-start', 'insert-end'));
    await page.mouse.click(canvasBox!.x + 300, canvasBox!.y + 200);
    await frames(page, 3);
    await mark(page, 'undo-start');
    await page.keyboard.press('Control+z');
    await frames(page, 5);
    await mark(page, 'undo-end');
    expect(await page.evaluate((r) => window.__ss.store.getCell(r, 0)?.value, headerRow)).toBe(headerRow * 10);
    record('longest block: undo the row insert', await longestBlock(page, 'undo-start', 'undo-end'));

    // The auto-save of a million-cell workbook: it fires 1.5 s after the last change.
    await mark(page, 'autosave-start');
    await page.waitForTimeout(7_000);
    await mark(page, 'autosave-end');
    record('longest block while idle for 7 s after the edit (auto-save)', await longestBlock(page, 'autosave-start', 'autosave-end'));

    const heapMb = await page.evaluate(() => Math.round(((performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0) / 1e6));
    await page.evaluate(() => { (window as unknown as { __frameStop: boolean }).__frameStop = true; });
    await page.screenshot({ path: 'coverage/scale-bench/browser-million.png' });

    // A cell typed far down a bold column shows the column's format without carrying a style of its own.
    await nameBox.click();
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await nameBox.fill('A500000');
    await page.keyboard.press('Enter');
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.keyboard.type('7');
    await page.keyboard.press('Enter');
    await frames(page, 3);
    expect(await page.evaluate(() => window.__ss.store.getCell(499_999, 0)?.value)).toBe(7);
    expect(await page.evaluate(() => { const s = window.__ss.store; return s.getCell(499_999, 0)?.styleId === undefined && s.getCellStyle(499_999, 0)?.bold === true; })).toBe(true);

    // A whole-column reference over the million-row sheet's first column.
    await nameBox.click();
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await nameBox.fill('K1');
    await page.keyboard.press('Enter');
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.keyboard.type('=SUM(A:A)');
    await page.keyboard.press('Enter');
    await frames(page, 3);
    expect(await page.evaluate(() => window.__ss.store.getCell(0, 10)?.value)).toBe(10 * 4_999_950_000 + 7);

    // The auto-save committed the workbook to IndexedDB (format v2): a reload brings it back from there.
    await page.waitForTimeout(4_000);
    const reopenStart = Date.now();
    await page.reload();
    await page.waitForSelector('canvas.ss-canvas');
    await page.waitForFunction(() => (window.__ss?.store.getCellCount() ?? 0) >= 1_000_000, undefined, { timeout: 120_000 });
    await frames(page, 3);
    record('reopen the saved million-cell workbook after a page reload (IndexedDB → on screen)', Date.now() - reopenStart);
    expect(await page.evaluate(() => window.__ss.store.getCell(1_048_575, 16_383)?.value)).toBe(42);
    expect(await page.evaluate(() => window.__ss.store.getCell(499_999, 0)?.value)).toBe(7);
    expect(await page.evaluate(() => window.__ss.store.getCellStyle(99_999, 0)?.bold)).toBe(true);
    expect(await page.evaluate(() => window.__ss.store.getCell(0, 10)?.value)).toBe(10 * 4_999_950_000 + 7);
    report(`experiment 4 · browser · one sheet of 1,000,000 cells · JS heap ${heapMb} MB`);
  });

  test('fifty sheets with twenty thousand cells each', async ({ page }) => {
    await openPage(page);
    await mark(page, 'load-start');
    const t0 = Date.now();
    await load(page, workbook(50, 2_000, 10));
    await frames(page, 3);
    const openMs = Date.now() - t0;
    record('open a 50-sheet workbook (1,000,000 cells)', openMs);
    ceiling('open 50 sheets', openMs, 15_000);
    await startFrameLogger(page);

    const tabTimes: number[] = [];
    for (const name of ['Sheet25', 'Sheet50', 'Sheet1', 'Sheet17']) {
      await mark(page, 'tab-start');
      await page.getByRole('tab', { name, exact: true }).click();
      await frames(page, 5);
      await mark(page, 'tab-end');
      tabTimes.push(await longestBlock(page, 'tab-start', 'tab-end'));
    }
    record('longest block while switching sheets (worst of 4)', Math.max(...tabTimes), tabTimes.map((t) => t.toFixed(0)).join(' / '));
    ceiling('switch sheet', Math.max(...tabTimes), 800);

    await page.evaluate(() => { (window as unknown as { __frameStop: boolean }).__frameStop = true; });
    report('experiment 4 · browser · 50 sheets x 20,000 cells');
  });
});

function report(title: string): void {
  const width = Math.max(...samples.map((s) => s.label.length));
  console.log(`\n┌─ ${title}`);
  for (const s of samples) console.log(`│ ${s.label.padEnd(width)}  ${s.ms.toFixed(1).padStart(10)} ms${s.note ? `   (${s.note})` : ''}`);
  console.log('└─');
  mkdirSync('coverage/scale-bench', { recursive: true });
  writeFileSync(`coverage/scale-bench/browser-${title.includes('50 sheets') ? 'sheets' : 'million'}.json`, JSON.stringify(samples, null, 2));
  samples.length = 0;
}
