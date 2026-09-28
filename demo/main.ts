import { DEFAULT_ID, Spreadsheet, deleteWorkbook, loadWorkbook } from '../src/index';

const data = [
  [{ text: '产品' }, { text: 'Q1' }, { text: 'Q2' }, { text: 'Q3' }, { text: 'Q4' }, { text: '总计' }],
  [{ text: '产品A' }, { text: '100' }, { text: '120' }, { text: '150' }, { text: '180' }, { formula: '=SUM(B2:E2)' }],
  [{ text: '产品B' }, { text: '80' }, { text: '90' }, { text: '110' }, { text: '130' }, { formula: '=SUM(B3:E3)' }],
  [{ text: '产品C' }, { text: '200' }, { text: '210' }, { text: '230' }, { text: '250' }, { formula: '=SUM(B4:E4)' }],
  [
    { text: '合计' },
    { formula: '=SUM(B2:B4)' },
    { formula: '=SUM(C2:C4)' },
    { formula: '=SUM(D2:D4)' },
    { formula: '=SUM(E2:E4)' },
    { formula: '=SUM(F2:F4)' },
  ],
];

const root = document.createElement('div');
root.id = 'root';
root.className = 'spreadsheet-host';
document.body.append(root);

const ss = new Spreadsheet(root, { data, theme: 'light' });
ss.mount();
(window as unknown as { __ss: Spreadsheet }).__ss = ss; // debug/test handle
// The demo seeds initial data, which opts the SDK out of its own restore
// (explicit data wins). Restore the last autosave here so a refresh keeps the
// user's work — the seed table only shows when nothing was saved yet. A user
// edit landing before the async load completes wins over the restore.
let touched = false;
const offTouchOnce = ss.store.subscribe(() => { touched = true; offTouchOnce(); });
void loadWorkbook(DEFAULT_ID).then((saved) => {
  if (saved === undefined || touched) return;
  ss.store.replaceAll(saved);
  ss.store.setWorkbookPasswordHash(saved.passwordHash);
  // Parity with the SDK's own restore (tryRestoreFromDB): the undo stack must
  // not cross the restore boundary — Ctrl+Z must not resurrect the seed table
  // over the restored workbook.
  ss.cmdManager.clear();
}).catch((err) => {
  // Private mode / blocked IndexedDB rejects; the seed table simply stays.
  // Surface it visibly — a silent console error looks like the app ignoring
  // the user's saved work.
  console.error('Failed to restore workbook from IndexedDB:', err);
  showRestoreError();
});

/** 恢复失败提示条：说明现状并提供「清除本地存档并刷新」的自救动作。 */
function showRestoreError(): void {
  if (document.getElementById('ss-restore-error') !== null) return;
  const bar = document.createElement('div');
  bar.id = 'ss-restore-error';
  bar.setAttribute('role', 'alert');
  bar.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:3000;display:flex;gap:12px;align-items:center;padding:8px 16px;'
    + 'background:#fff7e6;border-bottom:1px solid #ffd591;color:#874d00;font:13px "Segoe UI","Microsoft YaHei",sans-serif;';
  const text = document.createElement('span');
  text.style.flex = '1';
  text.textContent = '本地自动存档读取失败，当前显示内置示例数据。';
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.textContent = '清除本地存档并刷新';
  clear.style.cssText = 'padding:2px 10px;border:1px solid #ffd591;border-radius:4px;background:#ffffff;color:#874d00;cursor:pointer;';
  clear.onclick = (): void => {
    const reload = (): void => { window.location.reload(); };
    deleteWorkbook(DEFAULT_ID).then(reload).catch(() => {
      // The store itself may be unreadable — drop the whole database.
      const req = indexedDB.deleteDatabase('web-spreadsheet');
      req.onsuccess = reload;
      req.onerror = reload;
      req.onblocked = reload;
    });
  };
  bar.append(text, clear);
  document.body.append(bar);
}

const info = document.createElement('div');
info.id = 'info';
info.className = 'demo-info';
root.parentElement?.insertBefore(info, root.nextSibling);
updateInfo(ss);
ss.store.subscribe(() => updateInfo(ss));

function updateInfo(spreadsheet: Spreadsheet): void {
  const total = spreadsheet.store.getCell(1, 5)?.text ?? '';
  info.textContent = `web-spreadsheet v1.0 demo · 产品A总计 ${total}`;
}
