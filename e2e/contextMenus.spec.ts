import { expect, test, type Page } from '@playwright/test';

/**
 * Context-menu family e2e (right-click is out of jsdom's reach). The demo
 * exposes `window.__ss` (Spreadsheet handle) for store-level assertions.
 */

async function cleanSlate(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForSelector('canvas.ss-canvas');
  await page.waitForFunction(() => window.__ss?.store !== undefined);
  // Overwrite whatever autosave restored with a deterministic 3×3 block —
  // deleting IndexedDB from inside the page races Dexie's open connection
  // (onblocked), so the store is seeded directly instead.
  await page.evaluate(() => {
    const store = window.__ss.store;
    const cells = [...store.getCells()];
    for (const [id] of cells) {
      const [r, c] = id.split(',').map(Number);
      store.setCell(r, c, undefined);
    }
    for (let r = 0; r < 3; r += 1) for (let c = 0; c < 3; c += 1) store.setCell(r, c, { text: `v${r}${c}` });
  });
}

/** Canvas cell center in page coordinates (viewport 1280×720, canvas at y=120). */
function cellPoint(col: number, row: number): { x: number; y: number } {
  return { x: 40 + col * 70 + 35, y: 120 + 20 + row * 20 + 10 };
}

async function storeText(page: Page, r: number, c: number): Promise<string> {
  return page.evaluate(([rr, cc]) => window.__ss.store.getCell(rr, cc)?.text ?? '', [r, c]);
}

test.beforeEach(async ({ page }) => { await cleanSlate(page); });

test('cell right-click opens the context menu; 清除内容 clears the cell', async ({ page }) => {
  await expect.poll(() => storeText(page, 0, 0)).toBe('v00');
  await page.mouse.click(cellPoint(0, 0).x, cellPoint(0, 0).y, { button: 'right' });
  const menu = page.locator('.ss-excel-ctx');
  await expect(menu).toBeVisible();
  await menu.getByText('清除内容').first().click();
  await expect.poll(() => storeText(page, 0, 0)).toBe('');
});

test('row-header right-click offers hide; hiding collapses the row', async ({ page }) => {
  await page.mouse.click(20, cellPoint(0, 1).y, { button: 'right' });
  const menu = page.locator('.ss-excel-ctx');
  await expect(menu).toBeVisible();
  const hideItem = menu.getByText('隐藏', { exact: true });
  await hideItem.click();
  await expect.poll(() => page.evaluate(() => window.__ss.store.getRow(1)?.hide === true)).toBe(true);
});

test('column-header right-click offers hide; hiding collapses the column', async ({ page }) => {
  await page.mouse.click(cellPoint(1, 0).x, 130, { button: 'right' });
  const menu = page.locator('.ss-excel-ctx');
  await expect(menu).toBeVisible();
  await menu.getByText('隐藏', { exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__ss.store.getCol(1)?.hide === true)).toBe(true);
});

test('sheet-tab right-click opens 移动或复制工作表 dialog', async ({ page }) => {
  const tab = page.locator('.ss-sheet-tab').first();
  await tab.click({ button: 'right' });
  // BottomBar renders its own menu (role=menu), not the canvas .ss-excel-ctx.
  await page.getByRole('menuitem', { name: /移动或复制/ }).click();
  const dialog = page.getByRole('dialog', { name: /移动或复制工作表/ });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /取 消/ }).click();
  await expect(dialog).toBeHidden();
});

test('插入 → 迷你图… creates a sparkline for a row range', async ({ page }) => {
  await page.getByRole('menuitem', { name: /插入\(I\)/ }).click();
  await page.getByRole('menuitem', { name: '迷你图...' }).click();
  const dialog = page.getByRole('dialog', { name: '插入迷你图' });
  await expect(dialog).toBeVisible();
  await dialog.getByPlaceholder('A1:A5').fill('B2:E2');
  await dialog.getByRole('button', { name: /^(确 定|OK)$/ }).click();
  await expect
    .poll(() => page.evaluate(() => window.__ss.store.getSparklines?.().length ?? -1))
    .toBeGreaterThan(0);
});

test('数据 → 分列… opens the delimiter dialog', async ({ page }) => {
  await page.getByRole('menuitem', { name: /数据\(D\)/ }).click();
  await page.getByRole('menuitem', { name: '分列...' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(/分列|分隔/).first()).toBeVisible();
  await dialog.getByRole('button', { name: /取 消/ }).click();
});

test('格式 → 条件格式 → 图标集 applies a 3-arrow rule (hover submenu)', async ({ page }) => {
  await page.getByRole('menuitem', { name: /格式\(O\)/ }).click();
  await page.getByRole('menuitem', { name: '条件格式' }).hover();
  await page.getByRole('menuitem', { name: '图标集' }).hover();
  await page.getByRole('menuitem', { name: '3 色箭头' }).click();
  await expect
    .poll(() => page.evaluate(() => {
      const rules = window.__ss.store.getConditionalRules();
      return rules.some(([, rs]) => rs.some((r) => r.type === 'iconSet'));
    }))
    .toBe(true);
});

test('cell right-click → 插入 shifts rows down', async ({ page }) => {
  await expect.poll(() => storeText(page, 0, 0)).toBe('v00');
  await page.mouse.click(cellPoint(0, 0).x, cellPoint(0, 0).y, { button: 'right' });
  const menu = page.locator('.ss-excel-ctx');
  await expect(menu).toBeVisible();
  await menu.getByText('插入...', { exact: true }).click();
  const confirm = page.locator('.ant-modal-confirm').filter({ hasText: '插入' });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: '确 定' }).click();
  // Default choice 整行: everything shifts down one row.
  await expect.poll(() => storeText(page, 0, 0)).toBe('');
  await expect.poll(() => storeText(page, 1, 0)).toBe('v00');
});
