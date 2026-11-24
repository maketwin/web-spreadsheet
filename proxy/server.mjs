#!/usr/bin/env node
/**
 * Mock 平台 · 通道③种子：本地反向代理（接口侦察模式）
 *
 * 用法：
 *   node proxy/server.mjs                 # 默认上游 https://www.yunoa.com，端口 8787
 *   UPSTREAM=https://www.yunoa.com PORT=8787 node proxy/server.mjs
 *
 * 打开 http://127.0.0.1:8787/ 正常登录/使用 OA（请求原样转发上游，会话走本机），
 * 另开 http://127.0.0.1:8787/__spy/ 实时看页面调了哪些接口（方法/入参/出参/耗时）。
 *
 * 安全边界：上游固定为启动配置的公网地址（仅 http/https，拒绝内网/环回/保留地址），
 * 不接受请求里指定的任意目标；会话 Cookie 只在本机浏览器与本地进程之间流转。
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const UPSTREAM = process.env.UPSTREAM ?? 'https://www.yunoa.com';
const PORT = Number(process.env.PORT ?? 8787);
const HOST = '127.0.0.1';
const LOCAL_ORIGIN = `http://${HOST}:${PORT}`;
const BODY_CAP = 256 * 1024; // 单条请求/响应体最多存 256KB
const LIST_CAP = 2000; // 内存里最多保留的调用记录数

/** 上游必须是公网 http/https 地址（拒绝环回/内网/保留段）——代理只指向这一个目标。 */
function assertSafeUpstream(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`上游协议必须是 http/https：${parsed.protocol}`);
  }
  const h = parsed.hostname;
  if (h === 'localhost' || h.endsWith('.localhost') || h === '::1' || h === '[::1]') throw new Error(`上游不能是环回地址：${h}`);
  if (/^(10\.|127\.|169\.254\.|192\.168\.)/.test(h)) throw new Error(`上游不能是内网地址：${h}`);
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) throw new Error(`上游不能是内网地址：${h}`);
  if (h.endsWith('.local') || h.endsWith('.internal')) throw new Error(`上游不能是保留域名：${h}`);
  return parsed;
}

const upstream = assertSafeUpstream(UPSTREAM);
const upstreamHost = upstream.hostname;

/**
 * 请求行只接受"以单个 / 开头的路径"。`//host/x`、`/\host/x` 和绝对形式会被 URL
 * 解析到别的主机——而转发时 Cookie 等请求头原样带过去，等于把会话送给第三方。
 */
export function isLocalTarget(path) {
  return typeof path === 'string' && path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\');
}

/**
 * Host 必须就是本代理自己的地址：管理端点（/__spy/*）里的接口清单带着业务数据，
 * 不能让别的网站借浏览器对 127.0.0.1 发跨站请求读走；也顺带挡住 DNS 重绑定。
 */
export function isLocalHostHeader(host, port) {
  return host === `127.0.0.1:${port}` || host === `localhost:${port}` || host === `[::1]:${port}`;
}

const calls = [];
let nextSeq = 1;
// 每次启动都不同：重启后序号从 1 重新开始，面板据此丢掉它记住的旧序号。
const bootId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const XHR_HINTS = /\/(api|oa|service|servlet|ajax|rest|gateway)\b|\.json|\/(get|save|query|list|export|import)/i;
const looksLikeXhr = (path, accept, contentType) =>
  (accept && accept.includes('json')) || (contentType && contentType.includes('json')) || XHR_HINTS.test(path);

function storeCall(rec) {
  calls.push({ ...rec, seq: nextSeq++, ts: Date.now() });
  if (calls.length > LIST_CAP) calls.splice(0, calls.length - LIST_CAP);
  if (rec.kind === 'xhr') {
    console.log(`#${String(nextSeq - 1).padStart(4, ' ')} ${rec.method.padEnd(7)} ${rec.status ?? '---'}  ${rec.ms ?? '?'}ms  ${rec.path}${rec.error !== null ? `  !! ${rec.error}` : ''}`);
  }
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  if (chunks.length === 0) return null;
  return Buffer.concat(chunks);
}

function bodyPreview(buf, cap = BODY_CAP) {
  if (buf === null) return null;
  const text = buf.subarray(0, cap).toString('utf8');
  const full = buf.length <= cap ? text : `${text}\n…（截断，共 ${buf.length} 字节）`;
  try {
    return JSON.stringify(JSON.parse(full), null, 2);
  } catch {
    return full;
  }
}

const HOP_HEADERS = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'proxy-connection', 'host', 'content-length']);
/** 剥离安全/框架限制头：本地代理场景下 CSP 与防嵌套会挡住页面与后续注入点。 */
const STRIP_RES_HEADERS = new Set([
  'content-security-policy', 'content-security-policy-report-only',
  'x-frame-options', 'cross-origin-opener-policy', 'cross-origin-embedder-policy',
  'strict-transport-security', 'content-encoding', 'content-length', 'transfer-encoding',
]);

async function forward(req, res) {
  const started = Date.now();
  const target = req.url ?? '/';
  if (!isLocalTarget(target) || !isLocalHostHeader(req.headers.host, PORT)) {
    res.statusCode = 400;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end('[proxy] 只接受指向本代理的路径形式请求');
    return;
  }
  const url = new URL(target, upstream.origin);
  const body = await readBody(req);

  const headers = {};
  for (const [key, values] of Object.entries(req.headers)) {
    const lower = key.toLowerCase();
    if (HOP_HEADERS.has(lower)) continue;
    const list = Array.isArray(values) ? values : [values];
    for (const v of list) {
      if (v === undefined) continue;
      // Origin/Referer 改回上游域名：后端的 CSRF 校验不认识 127.0.0.1
      if (lower === 'origin' || lower === 'referer') {
        headers[key] = headers[key] ?? upstream.origin;
        continue;
      }
      headers[key] = headers[key] === undefined ? String(v) : `${headers[key]}, ${String(v)}`;
    }
  }
  headers.host = upstream.host;

  const isXhr = looksLikeXhr(url.pathname, req.headers.accept, req.headers['content-type']);
  const record = {
    method: req.method ?? 'GET',
    path: url.pathname,
    query: Object.fromEntries(url.searchParams.entries()),
    status: null,
    ms: null,
    kind: isXhr ? 'xhr' : 'asset',
    reqType: req.headers['content-type'] ?? null,
    reqBody: isXhr ? bodyPreview(body) : null,
    resType: null,
    resBody: null,
    error: null,
  };

  try {
    const upstreamRes = await fetch(url, {
      method: req.method,
      headers,
      body: body === null || req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
      redirect: 'manual',
    });
    const resBody = Buffer.from(await upstreamRes.arrayBuffer());
    record.status = upstreamRes.status;
    record.ms = Date.now() - started;
    record.resType = upstreamRes.headers.get('content-type');

    for (const [key, value] of upstreamRes.headers) {
      if (HOP_HEADERS.has(key) || STRIP_RES_HEADERS.has(key)) continue;
      if (key === 'set-cookie') continue; // 单独处理
      if (key === 'location') {
        res.setHeader('location', rewriteLocation(value));
        continue;
      }
      res.setHeader(key, value);
    }
    // Set-Cookie：去掉 Domain/SameSite 限制，让会话落在本地域。一次可能下发多条
    // （逐条 setHeader 会互相覆盖，只剩最后一条），整体作为数组设置。
    const cookies = typeof upstreamRes.headers.getSetCookie === 'function'
      ? upstreamRes.headers.getSetCookie()
      : (upstreamRes.headers.get('set-cookie') ? [upstreamRes.headers.get('set-cookie')] : []);
    const rewritten = cookies.map((cookie) => cookie.replace(/;\s*domain=[^;]+/gi, '').replace(/;\s*samesite=[^;]+/gi, ''));
    if (rewritten.length > 0) res.setHeader('set-cookie', rewritten);

    if (isXhr || (upstreamRes.headers.get('content-type') ?? '').includes('json')) {
      record.kind = 'xhr';
      record.resBody = bodyPreview(resBody);
    }
    res.statusCode = upstreamRes.status;
    res.end(resBody);
  } catch (err) {
    record.error = err instanceof Error ? err.message : String(err);
    record.ms = Date.now() - started;
    console.error(`#${nextSeq} 转发失败 ${url.pathname}: ${record.error}`);
    res.statusCode = 502;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end(`[proxy] 上游转发失败：${record.error}`);
  } finally {
    storeCall(record);
  }
}

/** 重定向目标改写回本地：同域族的跳转保持走代理，其他域原样放行（如 SSO 站外跳转）。 */
function rewriteLocation(location) {
  try {
    const target = new URL(location, upstream.origin);
    const h = target.hostname;
    if (h === upstreamHost || h.endsWith(`.${upstreamHost}`)) {
      return `${target.pathname}${target.search}${target.hash}`;
    }
    return location;
  } catch {
    return location;
  }
}

const here = dirname(fileURLToPath(import.meta.url));
/** 直接 `node proxy/server.mjs` 才启动；被测试 import 时只拿到纯函数。 */
const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

const server = createServer((req, res) => {
  const path = req.url ?? '/';
  if (path.startsWith('/__spy') && !isLocalHostHeader(req.headers.host, PORT)) {
    res.statusCode = 403;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end('[proxy] 管理端点只接受本机访问');
    return;
  }
  if (path === '/__spy' || path === '/__spy/') {
    readFile(join(here, 'dashboard.html'), 'utf8')
      .then((html) => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(html); })
      .catch((err) => { res.statusCode = 500; res.end(String(err)); });
    return;
  }
  if (path.startsWith('/__spy/api/calls')) {
    const since = Number(new URL(path, LOCAL_ORIGIN).searchParams.get('since') ?? 0);
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ bootId, calls: calls.filter((c) => c.seq > since) }));
    return;
  }
  if (path === '/__spy/api/clear') {
    calls.length = 0;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end('{"ok":true}');
    return;
  }
  if (path === '/__spy/api/export') {
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('content-disposition', 'attachment; filename="api-calls.json"');
    res.end(JSON.stringify(calls.filter((c) => c.kind === 'xhr'), null, 2));
    return;
  }
  forward(req, res).catch(() => {
    if (!res.headersSent) {
      res.statusCode = 500;
      res.end('[proxy] internal error');
    }
  });
});

if (isMain) {
  server.listen(PORT, HOST, () => {
    console.log('='.repeat(64));
    console.log('Mock 平台 · 接口侦察代理已启动');
    console.log(`  上游：${upstream.origin}`);
    console.log(`  ① 用 OA：    ${LOCAL_ORIGIN}/          （登录后照常使用）`);
    console.log(`  ② 看流量：   ${LOCAL_ORIGIN}/__spy/     （实时接口清单）`);
    console.log(`  ③ 导出清单： 面板里的"导出 JSON"按钮`);
    console.log('='.repeat(64));
  });
}
