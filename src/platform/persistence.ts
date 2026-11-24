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

/** 轻量结构校验：字段齐全、id 唯一即通过（导入坏文件时报可读错误）。 */
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
    ifaceIds.add(i.id);
  }
  for (const r of rules as unknown[]) {
    if (!isRecord(r) || typeof r.id !== 'string' || typeof r.interfaceId !== 'string' || !ifaceIds.has(r.interfaceId) || !isRecord(r.response)) {
      throw new Error(`规则 ${String(isRecord(r) ? r.id : r)} 不完整或引用了不存在的接口`);
    }
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

/** 写入 localStorage（宿主在 hub.onChange 里防抖调用）。 */
export function persistProject(hub: MockHub): void {
  const captures = hub.exportCaptures();
  const payload: PersistedProject = {
    version: EXPORT_VERSION,
    project: hub.project,
    activeScenarioId: hub.activeScenarioId,
    ...(Object.keys(captures).length > 0 ? { captures } : {}),
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // 隐私模式/超配额：持久化失败不阻断使用
  }
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

/** 读取导入的项目文件；结构不合法时抛可读错误。 */
export async function importProjectFile(file: File): Promise<PersistedProject> {
  const text = await file.text();
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed)) throw new Error('文件内容不是对象');
  const project = validateProject(parsed.project);
  const active = typeof parsed.activeScenarioId === 'string' ? parsed.activeScenarioId : null;
  return { version: EXPORT_VERSION, project, activeScenarioId: active };
}
