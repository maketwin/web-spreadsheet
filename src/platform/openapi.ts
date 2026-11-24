import type { ApiInterface, ApiRule } from './types';

/**
 * OpenAPI/Swagger 文档 → 平台接口。轻量解析（无第三方依赖）：
 * - paths 下 GET/POST 生成接口（PUT/DELETE 等平台不支持，进 skipped）；
 * - operationId/summary 做名称，path 做模板（{param} 原生兼容）；
 * - servers[0].url + path 作为真实上游（有上游自动配一条 capture 规则，
 *   导入后"同步真实数据"即可直通）；无上游配一条空 static 占位规则；
 * - required query 参数生成存在性断言。
 */

export interface OpenApiImport {
  readonly interfaces: readonly ApiInterface[];
  readonly rules: readonly ApiRule[];
  /** 因方法不支持等原因跳过的操作（path method）。 */
  readonly skipped: readonly string[];
}

const SUPPORTED = new Set(['get', 'post']);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const sanitizeId = (s: string): string => s.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'op';

export function interfacesFromOpenApi(doc: unknown): OpenApiImport {
  if (!isRecord(doc) || !isRecord(doc.paths)) throw new Error('不是 OpenAPI 文档（缺少 paths）');
  const serverUrl = Array.isArray(doc.servers) && isRecord(doc.servers[0]) && typeof doc.servers[0].url === 'string'
    ? doc.servers[0].url.replace(/\/+$/, '')
    : '';
  const interfaces: ApiInterface[] = [];
  const rules: ApiRule[] = [];
  const skipped: string[] = [];

  for (const [path, pathItem] of Object.entries(doc.paths)) {
    if (!isRecord(pathItem)) continue;
    for (const [methodLower, operation] of Object.entries(pathItem)) {
      if (methodLower.startsWith('x-') || methodLower === 'parameters') continue;
      if (!isRecord(operation)) continue;
      const method = methodLower.toUpperCase();
      if (!SUPPORTED.has(methodLower)) {
        skipped.push(`${method} ${path}`);
        continue;
      }
      const op = operation as Record<string, unknown>;
      const opId = typeof op.operationId === 'string' ? op.operationId : '';
      const summary = typeof op.summary === 'string' ? op.summary : '';
      const name = summary || opId || `${method} ${path}`;
      const id = `oa-${sanitizeId(`${methodLower}-${opId || path}`)}`;
      // required query 参数 → 存在性断言（验行为：表格必须带上这些入参）
      const assertions = Array.isArray(op.parameters)
        ? op.parameters
          .filter((p): p is Record<string, unknown> => isRecord(p) && p.in === 'query' && p.required === true)
          .map((p) => ({ key: String(p.name ?? '') }))
          .filter((a) => a.key !== '')
        : [];
      const upstream = serverUrl !== '' && !serverUrl.includes('example.com') ? `${serverUrl}${path}` : undefined;
      interfaces.push({
        id,
        name,
        method: method as ApiInterface['method'],
        urlPattern: path,
        fallback: 'error',
        ...(upstream !== undefined ? { upstream } : {}),
        ...(assertions.length > 0 ? { assertions } : {}),
      });
      rules.push(upstream !== undefined
        ? { id: `${id}-capture`, interfaceId: id, name: '真实捕获', matchers: {}, response: { kind: 'capture', body: null }, fault: 'none', enabled: true, priority: 50 }
        : { id: `${id}-stub`, interfaceId: id, name: '占位（待编辑）', matchers: {}, response: { kind: 'static', body: null }, fault: 'none', enabled: true, priority: 50 });
    }
  }
  if (interfaces.length === 0) throw new Error('文档里没有可导入的 GET/POST 操作');
  return { interfaces, rules, skipped };
}

export async function importOpenApiFile(file: File): Promise<OpenApiImport> {
  const text = await (typeof file.text === 'function'
    ? file.text()
    : new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'));
      reader.readAsText(file);
    }));
  return interfacesFromOpenApi(JSON.parse(text));
}
