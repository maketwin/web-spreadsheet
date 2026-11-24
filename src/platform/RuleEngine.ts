import type { ApiInterface, ApiRule, RuleMatchers, Scenario } from './types';

/** URL 解析结果：路径用于接口定位，query 用于规则匹配与模板渲染。 */
export interface ParsedUrl {
  readonly path: string;
  readonly query: Readonly<Record<string, string>>;
}

export function parseUrl(url: string): ParsedUrl {
  const q = url.indexOf('?');
  const path = q === -1 ? url : url.slice(0, q);
  const search = q === -1 ? '' : url.slice(q + 1);
  const query: Record<string, string> = {};
  for (const pair of search.split('&')) {
    if (pair === '') continue;
    const eq = pair.indexOf('=');
    if (eq === -1) {
      query[decodeURIComponent(pair)] = '';
    } else {
      query[decodeURIComponent(pair.slice(0, eq))] = decodeURIComponent(pair.slice(eq + 1));
    }
  }
  return { path, query };
}

export interface InterfaceMatch {
  readonly iface: ApiInterface;
  /** {param} 路径段提取出的参数，供模板 {{path.x}} 引用。 */
  readonly params: Readonly<Record<string, string>>;
}

/** method + 路径分段匹配（支持 {param} 捕获）。 */
export function matchInterface(
  ifaces: readonly ApiInterface[],
  method: string,
  path: string,
): InterfaceMatch | undefined {
  const segs = path.split('/').filter((s) => s !== '');
  for (const iface of ifaces) {
    if (iface.method !== method) continue;
    const patSegs = iface.urlPattern.split('/').filter((s) => s !== '');
    if (patSegs.length !== segs.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < patSegs.length; i++) {
      const pat = patSegs[i];
      const seg = segs[i];
      if (pat === undefined || seg === undefined) {
        ok = false;
        break;
      }
      const m = pat.match(/^\{(\w+)\}$/);
      if (m !== null) {
        params[m[1] ?? ''] = seg;
      } else if (pat !== seg) {
        ok = false;
        break;
      }
    }
    if (ok) return { iface, params };
  }
  return undefined;
}

/** 全部 matcher 命中才匹配；'*' 通配任意值（含缺失）。 */
export function matchesQuery(matchers: RuleMatchers, query: Readonly<Record<string, string>>): boolean {
  for (const [key, expected] of Object.entries(matchers.query ?? {})) {
    if (expected === '*') continue;
    if (query[key] !== expected) return false;
  }
  return true;
}

/**
 * 规则选择：场景钦定的规则优先（场景是"这个接口用哪条规则"的显式选择），
 * 钦定规则不匹配入参时，回退到按优先级扫描其余启用规则——这是同一接口
 * 按不同入参分化出参的通道。
 */
export function pickRule(
  iface: ApiInterface,
  rules: readonly ApiRule[],
  scenario: Scenario | undefined,
  query: Readonly<Record<string, string>>,
): ApiRule | undefined {
  const mine = rules
    .filter((r) => r.interfaceId === iface.id && r.enabled)
    .sort((a, b) => a.priority - b.priority);
  const pickedId = scenario?.rules[iface.id];
  const picked = pickedId !== undefined ? mine.find((r) => r.id === pickedId) : undefined;
  if (picked !== undefined && matchesQuery(picked.matchers, query)) return picked;
  return mine.find((r) => matchesQuery(r.matchers, query));
}

export interface TemplateContext {
  readonly query: Readonly<Record<string, string>>;
  readonly path: Readonly<Record<string, string>>;
}

/** 渲染 template 出参：深遍历 body，替换字符串里的 {{query.x}} / {{path.x}}。 */
export function renderTemplate(value: unknown, ctx: TemplateContext): unknown {
  if (typeof value === 'string') return substitute(value, ctx);
  if (Array.isArray(value)) return value.map((item) => renderTemplate(item, ctx));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, renderTemplate(v, ctx)]));
  }
  return value;
}

function substitute(text: string, ctx: TemplateContext): unknown {
  const whole = text.match(/^\s*\{\{\s*([\w.]+)\s*\}\}\s*$/);
  if (whole !== null) {
    const resolved = resolvePath(whole[1] ?? '', ctx);
    // 整串占位符保留原始类型（数字还是数字）；未解析到的路径留空。
    return resolved === undefined ? '' : resolved;
  }
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, expr: string) => {
    const resolved = resolvePath(expr, ctx);
    return resolved === undefined ? '' : String(resolved);
  });
}

function resolvePath(expr: string, ctx: TemplateContext): unknown {
  const [head = '', ...rest] = expr.split('.');
  let node: unknown = head === 'query' ? ctx.query : head === 'path' ? ctx.path : undefined;
  for (const key of rest) {
    if (node === null || node === undefined || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

/**
 * 稳定伪随机（FNV-1a 摘要 → [0,1)）：同一种子必得同一结果。概率故障用
 * `规则id#第N次命中` 做种子，回放时命中序列重建 → 概率结果可复现。
 */
export function seededFlip(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 10000 / 10000;
}

export interface ScriptResult {
  readonly ok: boolean;
  readonly body?: unknown;
  readonly error?: string;
}

/**
 * 执行脚本出参：签名 `(req) => body`，req = { query, path }，返回值即出参。
 *
 * 隔离级别（有意为之的 M2 取舍）：new Function + strict 模式，无 this 泄漏、
 * 异常被捕获转为 #API!；但它仍在主线程运行，理论可访问全局对象——单机
 * 工具里规则是用户自己写的，可接受；团队部署前须换 Web Worker / QuickJS
 * 真隔离（M3，需先落异步求值）。
 */
export function runScript(code: string, ctx: TemplateContext): ScriptResult {
  try {
    const fn = new Function('req', `"use strict";\n${code}`) as (req: TemplateContext) => unknown;
    const body = fn(ctx);
    if (body === undefined) return { ok: false, error: '脚本没有返回值（缺 return）' };
    return { ok: true, body };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
