import { registry, type FunctionSpec } from '../formula/registry';
import { matrix, type FormulaArgument, type FormulaValue } from '../formula/types';
import { API_ERROR, type MockHub } from './MockHub';
import type { HttpMethod } from './types';

/**
 * 函数桥（接管通道①）：向公式引擎注册 API.* 取数函数，调用全部进 MockHub
 * 规则引擎——命中返回 mock 出参，未命中/故障返回 #API!。
 *
 * - API.GET(url [, key])  标量取数：body 是对象时用 key 取字段
 * - API.POST(url [, key]) 同上，method 为 POST
 * - API.DATA(url)         明细取数：二维数组出参以动态数组溢出到相邻单元格
 */

const scalarOf = (arg: FormulaArgument | undefined): FormulaValue => {
  if (arg === undefined || arg === null) return '';
  if (Array.isArray(arg)) return arg.length > 0 ? (arg[0] as FormulaValue) : '';
  if (typeof arg === 'object') return ''; // MatrixValue：URL 参数不该是矩阵，视为空
  return arg;
};

function toResult(body: unknown, key?: string): FormulaArgument {
  if (body === null || body === undefined) return '';
  if (typeof body === 'object') {
    if (key === undefined || key === '') return JSON.stringify(body);
    const v = (body as Record<string, unknown>)[key];
    if (v === undefined) return '#N/A';
    return typeof v === 'object' && v !== null ? JSON.stringify(v) : (v as FormulaValue);
  }
  return body as FormulaValue;
}

function toCellPrimitive(v: unknown): FormulaValue {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') return JSON.stringify(v);
  return v as FormulaValue;
}

function toMatrix(body: unknown): FormulaArgument {
  if (!Array.isArray(body)) return toResult(body);
  if (body.length === 0) return ''; // 空数据：溢出收敛，单元格留空
  const rows = body.every((r) => Array.isArray(r)) ? (body as unknown[][]) : body.map((v) => [v]);
  const cols = Math.max(...rows.map((r) => r.length));
  const data: FormulaValue[] = [];
  for (const row of rows) {
    for (let c = 0; c < cols; c++) data.push(toCellPrimitive(row[c]));
  }
  return matrix(rows.length, cols, data);
}

/** 三个取数函数的 FunctionSpec 工厂。拆出来是因为 registry 是全局单例，测试要绑自己的 hub。 */
export function apiFunctionSpecs(hub: MockHub): { readonly GET: FunctionSpec; readonly POST: FunctionSpec; readonly DATA: FunctionSpec } {
  const scalarCall = (method: HttpMethod) => (args: readonly FormulaArgument[]): FormulaArgument => {
    const url = String(scalarOf(args[0]) ?? '');
    const keyArg = scalarOf(args[1]);
    const key = keyArg === '' || keyArg === undefined ? undefined : String(keyArg);
    const body = hub.call(method, url);
    if (body === API_ERROR) return API_ERROR;
    return toResult(body, key);
  };
  return {
    GET: { minArgs: 1, maxArgs: 2, evaluate: scalarCall('GET') },
    POST: { minArgs: 1, maxArgs: 2, evaluate: scalarCall('POST') },
    DATA: {
      minArgs: 1,
      maxArgs: 1,
      evaluate: (args) => {
        const body = hub.call('GET', String(scalarOf(args[0]) ?? ''));
        if (body === API_ERROR) return API_ERROR;
        return toMatrix(body);
      },
    },
  };
}

export function installApiFunctions(hub: MockHub): void {
  if (registry.has('API.GET')) return; // 注册表是全局单例，幂等安装
  const specs = apiFunctionSpecs(hub);
  registry.register('API.GET', specs.GET);
  registry.register('API.POST', specs.POST);
  registry.register('API.DATA', specs.DATA);
}
