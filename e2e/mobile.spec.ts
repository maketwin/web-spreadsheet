import { expect, test, type Page } from '@playwright/test';

/**
 * 移动端手势 e2e（chromium-touch project：390×844 触屏视口）。
 * 点选用 Playwright 原生触摸；平移/长按/捏合走页面内合成的 PointerEvent
 * （渲染器按 pointerType 分流、不要求 isTrusted——与真机同一代码路径）。
 * 软键盘（visualViewport 收缩）无法在无头浏览器复现，留给真机 QA 清单。
 */

async function cleanSlate(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForSelector('canvas.ss-canvas');
  await page.waitForFunction(() => window.__ss?.store !== undefined);
  await page.evaluate(() => {
    const store = window.__ss.store;
    for (const [id] of [...store.getCells()]) {
      const [r, c] = id.split(',').map(Number);
      store.setCell(r, c, undefined);
    }
    for (let r = 0; r < 3; r += 1) for (let c = 0; c < 3; c += 1) store.setCell(r, c, { text: `v${r}${c}` });
    // 0-59 行的第 0 列全部有文本：平移落点在任意行都能断言"不是种子块"。
    for (let r = 0; r < 60; r += 1) store.setCell(r, 0, { text: `r${r}` });
  });
}

/** 合成触摸序列：pointerdown 派发到画布，move/up 派发到 window（与监听一致）。 */
async function touchSequence(page: Page, steps: Array<{ type: 'pointerdown' | 'pointermove' | 'pointerup'; x: number; y: number; id?: number }>): Promise<void> {
  await page.evaluate((events) => {
    const canvas = document.querySelector('canvas.ss-canvas') as HTMLCanvasElement;
    for (const e of events) {
      const ev = new MouseEvent(e.type, { bubbles: true, cancelable: true, clientX: e.x, clientY: e.y, button: 0 });
      Object.defineProperty(ev, 'pointerId', { value: e.id ?? 1 });
      Object.defineProperty(ev, 'pointerType', { value: 'touch' });
      (e.type === 'pointerdown' ? canvas : window).dispatchEvent(ev);
    }
  }, steps);
}

async function canvasOrigin(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const rect = (document.querySelector('canvas.ss-canvas') as HTMLCanvasElement).getBoundingClientRect();
    return { x: rect.left, y: rect.top };
  });
}

/** 画布内网格坐标（列宽 70 / 行高 20，表头 46×20）。 */
const cell = (origin: { x: number; y: number }, col: number, row: number): { x: number; y: number } => ({
  x: origin.x + 46 + col * 70 + 35,
  y: origin.y + 20 + row * 20 + 10,
});

test.beforeEach(async ({ page }) => { await cleanSlate(page); });

test('tap selects a cell; double-tap opens the cell editor', async ({ page }) => {
  const origin = await canvasOrigin(page);
  const b2 = cell(origin, 1, 1);
  await page.touchscreen.tap(b2.x, b2.y);
  await expect(page.locator('.ss-formula-name')).toHaveValue(/B2/i);
  // Double-tap → editor opens with the cell text (native taps land fast enough
  // for the renderer's 300ms double-tap window).
  await page.touchscreen.tap(b2.x, b2.y);
  await page.touchscreen.tap(b2.x, b2.y);
  const editor = page.locator('textarea.ss-editor-overlay');
  await expect(editor).toBeVisible();
  await expect(editor).toHaveValue('v11');
  await page.keyboard.press('Escape');
});

test('long-press opens the cell context menu and 清除内容 works', async ({ page }) => {
  const origin = await canvasOrigin(page);
  const p = cell(origin, 0, 0);
  await touchSequence(page, [{ type: 'pointerdown', x: p.x, y: p.y }]);
  // 手指按住 550ms → 菜单出现。
  await page.waitForTimeout(700);
  await touchSequence(page, [{ type: 'pointerup', x: p.x, y: p.y }]);
  const menu = page.locator('.ss-excel-ctx');
  await expect(menu).toBeVisible();
  await menu.getByText('清除内容').first().click();
  await expect.poll(() => page.evaluate(() => window.__ss.store.getCell(0, 0)?.text ?? '')).toBe('');
});

test('one-finger drag pans the sheet: the top-left cell is now a far row', async ({ page }) => {
  const origin = await canvasOrigin(page);
  const start = { x: origin.x + 46 + 35, y: origin.y + 300 };
  const steps: Array<{ type: 'pointerdown' | 'pointermove' | 'pointerup'; x: number; y: number }> = [
    { type: 'pointerdown', x: start.x, y: start.y },
  ];
  for (let i = 1; i <= 10; i += 1) steps.push({ type: 'pointermove', x: start.x, y: start.y - i * 30 });
  steps.push({ type: 'pointerup', x: start.x, y: start.y - 300 });
  await touchSequence(page, steps);
  // 拖移 300px（行高 20 → 15 行）后点左上角：公式栏应是远端行文本。
  // 每轮先 Escape 关掉可能被上一轮快速连点误开的双击编辑器（156d5f3 的
  // 事故模式）；带行号区间的断言同时防过冲（>17）与欠冲（<13），不再
  // 接受 0-59 行的任意命中。
  await expect(async () => {
    await page.keyboard.press('Escape');
    const o = await canvasOrigin(page);
    await page.touchscreen.tap(o.x + 46 + 35, o.y + 30);
    const bar = await page.locator('.ss-formula-input').inputValue();
    const row = bar.match(/^r(\d+)$/)?.[1];
    expect(row, `expected a far row, got "${bar}"`).toBeDefined();
    expect(Number(row)).toBeGreaterThanOrEqual(13);
    expect(Number(row)).toBeLessThanOrEqual(17);
  }).toPass({ timeout: 15_000 });
});

test('two-finger pinch changes the zoom level', async ({ page }) => {
  const origin = await canvasOrigin(page);
  const cy = origin.y + 300;
  const cx = origin.x + 150;
  const events: Array<{ type: 'pointerdown' | 'pointermove' | 'pointerup'; x: number; y: number; id: number }> = [
    { type: 'pointerdown', x: cx - 60, y: cy, id: 1 },
    { type: 'pointerdown', x: cx + 60, y: cy, id: 2 },
  ];
  for (let i = 1; i <= 5; i += 1) {
    events.push({ type: 'pointermove', x: cx - 60 - i * 10, y: cy, id: 1 });
    events.push({ type: 'pointermove', x: cx + 60 + i * 10, y: cy, id: 2 });
  }
  await touchSequence(page, events);
  // 状态栏末尾的缩放百分比应 > 100%（两指张开）。
  const zoomPct = async (): Promise<number> => {
    const text = await page.locator('.ss-status-bar').textContent();
    return parseInt(text?.match(/(\d+)%\s*$/)?.[1] ?? '0', 10);
  };
  await expect.poll(zoomPct, { timeout: 5000 }).toBeGreaterThan(100);
});

test('sheet-tab long-press opens the tab menu', async ({ page }) => {
  const tab = page.locator('.ss-sheet-tab').first();
  const tabBox = await tab.boundingBox();
  if (tabBox === null) throw new Error('tab not visible');
  await tab.dispatchEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'touch', pointerId: 1, clientX: tabBox.x + 5, clientY: tabBox.y + 5, button: 0 });
  await page.waitForTimeout(700);
  await tab.dispatchEvent('pointerup', { bubbles: true, cancelable: true, pointerType: 'touch', pointerId: 1, clientX: tabBox.x + 5, clientY: tabBox.y + 5, button: 0 });
  await expect(page.locator('.ss-sheet-tab-menu')).toBeVisible();
  // 收尾：点空白处关掉菜单，避免污染下一条用例。
  await page.mouse.click(5, 5);
  await expect(page.locator('.ss-sheet-tab-menu')).toHaveCount(0);
});
