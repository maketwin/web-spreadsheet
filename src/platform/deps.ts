import type { Store } from '../store/Store';
import { num2alpha } from '../util/alphabet';
import { matchInterface } from './RuleEngine';
import type { MockHub } from './MockHub';

/** 一个依赖单元格：工作表名 + A1 引用。 */
export interface CellDep {
  readonly sheetName: string;
  readonly ref: string;
}

export interface DependencyMap {
  /** interfaceId → 依赖它的单元格（公式里引用了该接口的 API.* 调用）。 */
  readonly byInterface: ReadonlyMap<string, readonly CellDep[]>;
}

const API_CALL = /API\.(GET|POST|DATA)\s*\(\s*"((?:[^"\\]|\\.)*)"/g;

/**
 * 依赖图谱：静态扫描全部工作表的公式，提取 API.* 调用里的 URL 字面量前缀
 * （拼接公式如 "/api/kpi?region="&B3 取其字面量部分），匹配到接口。
 * 数据来自 store.serialize() 快照，按需计算（工作簿变更后重新调用）。
 */
export function buildDependencyMap(store: Store, hub: MockHub): DependencyMap {
  const byInterface = new Map<string, CellDep[]>();
  const interfaces = hub.project.interfaces;
  for (const sheet of store.serialize().sheets) {
    for (const [key, cell] of sheet.data.cells) {
      const formula = cell.formula;
      if (formula === undefined) continue;
      const comma = key.indexOf(',');
      const r = Number(key.slice(0, comma));
      const c = Number(key.slice(comma + 1));
      if (!Number.isInteger(r) || !Number.isInteger(c)) continue;
      for (const m of formula.matchAll(API_CALL)) {
        const fn = m[1] ?? 'GET';
        // 拼接公式的字面量前缀：截到 query 之前做路径匹配
        const path = (m[2] ?? '').split('?')[0]?.trim() ?? '';
        if (path === '') continue;
        const method = fn === 'POST' ? 'POST' : 'GET';
        const hit = matchInterface(interfaces, method, path);
        if (hit === undefined) continue;
        const list = byInterface.get(hit.iface.id) ?? [];
        const dep: CellDep = { sheetName: sheet.name, ref: `${num2alpha(c)}${r + 1}` };
        if (!list.some((d) => d.sheetName === dep.sheetName && d.ref === dep.ref)) list.push(dep);
        byInterface.set(hit.iface.id, list);
      }
    }
  }
  return { byInterface };
}
