import type { MockHub } from './MockHub';
import type { ApiInterface, ApiRule, MockProject, Scenario } from './types';

const STORAGE_KEY = 'ssp:project:v1';
const EXPORT_VERSION = 1;

export interface PersistedProject {
  readonly version: number;
  readonly project: MockProject;
  readonly activeScenarioId: string | null;
  /** 捕获快照（interfaceId -> 命中上游的响应）：持久化真实数据，刷新后 capture 规则仍可用。 */
  readonly captures?: Readonly<Record<string, unknown>>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 面板渲染与规则引擎直接读取的字段：缺失/形状不对会让面板崩溃或行为怪异，导入时就拒绝。 */
const RESPONSE_KINDS = new Set(['static', 'template', 'capture', 'script']);
const FAULT_KINDS = new Set(['none', 'error', 'timeout']);
const HTTP_METHODS = new Set(['GET', 'POST']);

/** 轻量结构校验：字段齐全、id 唯一、面板会直读的字段形状正确（导入坏文件时报可读错误）。 */
export function validateProject(v: unknown): MockProject {
  if (!isRecord(v)) throw new Error('项目根必须是对象');
  const { name, interfaces, rules, scenarios } = v;
  if (typeof name !== 'string') throw new Error('缺少项目名');
  if (!Array.isArray(interfaces) || !Array.isArray(rules) || !Array.isArray(scenarios)) throw new Error('interfaces/rules/scenarios 必须是数组');
  const ifaceIds = new Set<string>();
  for (const i of interfaces as unknown[]) {
    if (!isRecord(i) || typeof i.id !== 'string' || typeof i.name !== 'string' || typeof i.urlPattern !== 'string') {
      throw new Error('接口定义不完整（需要 id/name/urlPattern）');
    }
    if (!HTTP_METHODS.has(String(i.method))) throw new Error(`接口 ${i.id} 的 method 必须是 GET 或 POST`);
    if (i.fallback !== 'error' && i.fallback !== 'empty') throw new Error(`接口 ${i.id} 的 fallback 必须是 error 或 empty`);
    if (i.upstream !== undefined && typeof i.upstream !== 'string') throw new Error(`接口 ${i.id} 的 upstream 必须是字符串`);
    if (i.assertions !== undefined && (!Array.isArray(i.assertions) || i.assertions.some((a) => !isRecord(a) || typeof a.key !== 'string'))) {
      throw new Error(`接口 ${i.id} 的断言定义不完整（每条需要 key）`);
    }
    ifaceIds.add(i.id);
  }
  for (const r of rules as unknown[]) {
    if (!isRecord(r) || typeof r.id !== 'string' || typeof r.interfaceId !== 'string' || !ifaceIds.has(r.interfaceId)) {
      throw new Error(`规则 ${String(isRecord(r) ? r.id : r)} 不完整或引用了不存在的接口`);
    }
    if (typeof r.name !== 'string') throw new Error(`规则 ${r.id} 缺少名称`);
    if (!isRecord(r.matchers)) throw new Error(`规则 ${r.id} 缺少 matchers`);
    if (!isRecord(r.response) || !RESPONSE_KINDS.has(String(r.response.kind))) {
      throw new Error(`规则 ${r.id} 的出参不完整（response.kind 必须是 static/template/capture/script）`);
    }
    if (!FAULT_KINDS.has(String(r.fault))) throw new Error(`规则 ${r.id} 的 fault 必须是 none/error/timeout`);
    if (typeof r.enabled !== 'boolean') throw new Error(`规则 ${r.id} 缺少 enabled`);
    if (typeof r.priority !== 'number' || !Number.isFinite(r.priority)) throw new Error(`规则 ${r.id} 的 priority 必须是数字`);
  }
  const scenarioIds = new Set<string>();
  for (const s of scenarios as unknown[]) {
    if (!isRecord(s) || typeof s.id !== 'string' || typeof s.name !== 'string' || !isRecord(s.rules)) {
      throw new Error('场景定义不完整');
    }
    scenarioIds.add(s.id);
  }
  if (scenarioIds.size !== (scenarios as unknown[]).length) throw new Error('场景 id 重复');
  return { name, interfaces: interfaces as ApiInterface[], rules: rules as ApiRule[], scenarios: scenarios as Scenario[] };
}

/** 项目里脚本出参规则的数量——导入外部项目/复现包时的执行风险评估。 */
export function countScriptRules(project: MockProject): number {
  return project.rules.filter((r) => r.response.kind === 'script').length;
}

/** 写入 localStorage（宿主在 hub.onChange 里防抖调用）。返回是否保存成功（隐私模式/超配额时 false）。 */
export function persistProject(hub: MockHub): boolean {
  const captures = hub.exportCaptures();
  const payload: PersistedProject = {
    version: EXPORT_VERSION,
    project: hub.project,
    activeScenarioId: hub.activeScenarioId,
    ...(Object.keys(captures).length > 0 ? { captures } : {}),
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    return true;
  } catch {
    // 隐私模式/超配额：持久化失败不阻断使用，但要让用户知道数据不会留存
    return false;
  }
}

let persistWarnShown = false;

/** 持久化失败的一次性可见提示：数据当前仍可用，但刷新即丢。宿主在保存失败时调用。 */
export function warnOncePersistFailed(): void {
  if (persistWarnShown) return;
  persistWarnShown = true;
  const bar = document.createElement('div');
  bar.textContent = '自动保存失败（隐私模式或存储配额已满）：本次修改仅在当前页面有效，刷新后会丢失';
  bar.className = 'ssp-import-error';
  document.body.append(bar);
  setTimeout(() => bar.remove(), 8000);
}

/** 恢复上次保存的项目；无存档或损坏时返回 null（宿主回落到种子项目）。 */
export function restoreProject(): PersistedProject | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return null;
    const project = validateProject(parsed.project);
    const active = typeof parsed.activeScenarioId === 'string' ? parsed.activeScenarioId : null;
    const captures = isRecord(parsed.captures) ? parsed.captures : undefined;
    return { version: EXPORT_VERSION, project, activeScenarioId: active, ...(captures !== undefined ? { captures } : {}) };
  } catch {
    return null;
  }
}

export function clearPersistedProject(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 同 persistProject：失败静默
  }
}

/** 导出为可分享的项目文件（浏览器下载，含捕获快照）。 */
export function exportProjectFile(hub: MockHub): void {
  const captures = hub.exportCaptures();
  const payload: PersistedProject = {
    version: EXPORT_VERSION,
    project: hub.project,
    activeScenarioId: hub.activeScenarioId,
    ...(Object.keys(captures).length > 0 ? { captures } : {}),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${hub.project.name || 'mock-platform'}.ssp.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** File.text 的 FileReader 兜底（jsdom 等宿主没有实现 Blob.text，与 bundle.ts 同款）。 */
function readAsText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'));
    reader.readAsText(file);
  });
}

/** 读取导入的项目文件；结构不合法时抛可读错误。 */
export async function importProjectFile(file: File): Promise<PersistedProject> {
  const parsed: unknown = JSON.parse(await readAsText(file));
  if (!isRecord(parsed)) throw new Error('文件内容不是对象');
  const project = validateProject(parsed.project);
  const active = typeof parsed.activeScenarioId === 'string' ? parsed.activeScenarioId : null;
  return { version: EXPORT_VERSION, project, activeScenarioId: active };
}
