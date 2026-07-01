import { message } from 'antd';
import { Spreadsheet, setTheme } from '../src/index';

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

const ss = new Spreadsheet(root, { data });
ss.mount();

const toolbar = document.createElement('div');
toolbar.className = 'demo-toolbar';
toolbar.innerHTML = `
  <button id="theme-toggle">切换主题</button>
  <button id="undo">撤销</button>
  <button id="redo">重做</button>
  <button id="demo-bold">B</button>
  <button id="demo-italic">I</button>
  <button id="demo-underline">U</button>
  <button id="demo-font-size">Font Size</button>
  <button id="demo-font-family">Arial</button>
  <button id="demo-align">Align</button>
  <button id="demo-dark">Dark</button>
  <span id="info">web-spreadsheet v1.0 demo</span>
`;
root.parentElement?.insertBefore(toolbar, root);

bindDemoActions(ss);
updateInfo(ss);

function bindDemoActions(spreadsheet: Spreadsheet): void {
  bindClick('theme-toggle', toggleTheme);
  bindClick('demo-dark', toggleTheme);
  bindClick('undo', () => spreadsheet.cmdManager.undo());
  bindClick('redo', () => spreadsheet.cmdManager.redo());
  bindClick('demo-bold', styleStub('Bold'));
  bindClick('demo-italic', styleStub('Italic'));
  bindClick('demo-underline', styleStub('Underline'));
  bindClick('demo-font-size', styleStub('Font Size'));
  bindClick('demo-font-family', styleStub('Arial'));
  bindClick('demo-align', styleStub('Align'));
}

function bindClick(id: string, handler: () => void): void {
  document.getElementById(id)?.addEventListener('click', handler);
}

function toggleTheme(): void {
  const cur = document.documentElement.getAttribute('data-spreadsheet-theme') || 'light';
  setTheme(cur === 'light' ? 'dark' : 'light');
  window.dispatchEvent(new CustomEvent('ss:theme-changed'));
}

function styleStub(label: string): () => void {
  return () => {
    message.info(`${label} style command coming soon`);
  };
}

function updateInfo(spreadsheet: Spreadsheet): void {
  window.setTimeout(() => {
    const total = spreadsheet.store.getCell(1, 5)?.text ?? '';
    const info = document.getElementById('info');
    if (info !== null) info.textContent = `web-spreadsheet v1.0 demo · 产品A总计 ${total}`;
  }, 0);
}
