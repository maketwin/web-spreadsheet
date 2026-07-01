import { Spreadsheet } from '../src/index';

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

const info = document.createElement('div');
info.id = 'info';
info.className = 'demo-info';
root.parentElement?.insertBefore(info, root.nextSibling);
updateInfo(ss);

function updateInfo(spreadsheet: Spreadsheet): void {
  window.setTimeout(() => {
    const total = spreadsheet.store.getCell(1, 5)?.text ?? '';
    info.textContent = `web-spreadsheet v1.0 demo · 产品A总计 ${total}`;
  }, 0);
}
