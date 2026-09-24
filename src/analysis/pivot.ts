import type { Store } from '../store/Store';
import { num2alpha } from '../util/alphabet';
import { parseRange } from '../util/cell';

/**
 * 数据透视表（基础版）：对选区按第一列分组，其余数值列求和，结果写入新的
 * "透视表" 工作表。v1 说明：建表 + 写入不进撤销历史（与导入文件同级操作）。
 */

export interface PivotResult {
  readonly sheetId: string;
  readonly headerRow: string[];
  readonly rows: Array<{ readonly label: string; readonly values: number[] }>;
}

/** 对 range（如 "A1:C10"）按首列标签分组、其余列求和，写入新工作表并激活。 */
export function buildPivotToNewSheet(store: Store, activeSheetId: string, rangeStr: string): PivotResult | null {
  let parsed;
  try {
    parsed = parseRange(rangeStr);
  } catch {
    return null;
  }
  const { r1, c1, r2, c2 } = parsed;
  if (r2 - r1 < 1 || c2 - c1 < 1) return null;

  // 分组：首列文本 → 各数据列的和
  const order: string[] = [];
  const sums = new Map<string, number[]>();
  for (let r = r1 + 1; r <= r2; r += 1) {
    const labelCell = store.getCell(r, c1, activeSheetId);
    const label = labelCell?.text ?? '';
    if (label === '') continue;
    let row = sums.get(label);
    if (row === undefined) {
      row = Array.from({ length: c2 - c1 }, () => 0);
      sums.set(label, row);
      order.push(label);
    }
    for (let c = c1 + 1; c <= c2; c += 1) {
      const v = store.getCell(r, c, activeSheetId)?.value;
      if (typeof v === 'number') row[c - c1 - 1]! += v;
    }
  }
  if (order.length === 0) return null;

  const headers: string[] = [];
  for (let c = c1; c <= c2; c += 1) headers.push(store.getCell(r1, c, activeSheetId)?.text ?? '');
  const rows = order.map((label) => ({ label, values: sums.get(label) ?? [] }));

  const name = `透视表${store.getSheets().length + 1}`;
  const newId = store.addSheet(name);
  store.setCell(0, 0, { text: headers[0] ?? '', value: headers[0] ?? '' }, newId);
  for (let i = 1; i < headers.length; i += 1) {
    store.setCell(0, i, { text: headers[i] ?? '', value: headers[i] ?? '' }, newId);
  }
  rows.forEach((row, index) => {
    store.setCell(index + 1, 0, { text: row.label, value: row.label }, newId);
    row.values.forEach((v, i) => {
      store.setCell(index + 1, i + 1, { text: String(v), value: v }, newId);
    });
  });
  store.activateSheet(newId);
  return { sheetId: newId, headerRow: headers, rows: rows.map((row) => ({ label: row.label, values: row.values })) };
}

/** 列号 → A 记法（导出供 UI 显示默认范围）。 */
export function pivotColumnLabel(c: number): string {
  return num2alpha(c);
}
