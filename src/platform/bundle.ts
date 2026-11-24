import type { Store, SerializedStore } from '../store/Store';
import type { MockHub } from './MockHub';
import { validateProject } from './persistence';
import type { MockProject, TimelineEvent } from './types';

const BUNDLE_VERSION = 1;

/**
 * 复现包（bug report bundle）：工作簿快照 + 接口/规则/场景 + 捕获 + 当时的
 * 操作/场景事件。导入后回放，即可确定性复现——因为回放中的接口调用全部
 * 命中同一套 mock 规则，没有真实后端的不确定性。
 */
export interface ReproBundle {
  readonly version: number;
  readonly exportedAt: number;
  readonly project: MockProject;
  readonly activeScenarioId: string | null;
  readonly captures?: Readonly<Record<string, unknown>>;
  readonly workbook: SerializedStore;
  /** 导出时的操作与场景事件（时间线的可回放子集，流量不入包）。 */
  readonly events: readonly TimelineEvent[];
}

export function buildBundle(hub: MockHub, store: Store): ReproBundle {
  const captures = hub.exportCaptures();
  return {
    version: BUNDLE_VERSION,
    exportedAt: Date.now(),
    project: hub.project,
    activeScenarioId: hub.activeScenarioId,
    ...(Object.keys(captures).length > 0 ? { captures } : {}),
    workbook: store.serialize(),
    events: hub.timeline.filter((e) => e.kind === 'op' || e.kind === 'scenario'),
  };
}

export function exportBundleFile(hub: MockHub, store: Store): void {
  const bundle = buildBundle(hub, store);
  const blob = new Blob([JSON.stringify(bundle)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${hub.project.name || 'mock-platform'}-复现包.repro.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** File.text 的 FileReader 兜底（jsdom 等宿主没有实现 Blob.text）。 */
function readAsText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'));
    reader.readAsText(file);
  });
}

/** 读取并校验复现包；结构不合法抛可读错误。 */
export async function importBundleFile(file: File): Promise<ReproBundle> {
  const parsed: unknown = JSON.parse(await readAsText(file));
  if (!isRecord(parsed)) throw new Error('复现包内容不是对象');
  if (parsed.version !== BUNDLE_VERSION) throw new Error(`复现包版本不支持（${String(parsed.version)}）`);
  const project = validateProject(parsed.project);
  const workbook = parsed.workbook;
  if (!isRecord(workbook) || !Array.isArray(workbook.sheets) || workbook.sheets.length === 0) {
    throw new Error('复现包缺少工作簿快照');
  }
  if (!Array.isArray(parsed.events)) throw new Error('复现包缺少事件流');
  const activeScenarioId = typeof parsed.activeScenarioId === 'string' ? parsed.activeScenarioId : null;
  const captures = isRecord(parsed.captures) ? parsed.captures : undefined;
  return {
    version: BUNDLE_VERSION,
    exportedAt: typeof parsed.exportedAt === 'number' ? parsed.exportedAt : Date.now(),
    project,
    activeScenarioId,
    ...(captures !== undefined ? { captures } : {}),
    workbook: workbook as unknown as SerializedStore,
    events: parsed.events as TimelineEvent[],
  };
}

/**
 * 应用复现包：换工作簿 + 换项目 + 装载捕获与事件流（时间线被替换为包内
 * 事件，等用户点"回放"重演）。undo 栈随之清空——旧工作簿的命令不能落进
 * 新文档。
 */
export function applyBundle(hub: MockHub, store: Store, bundle: ReproBundle, clearUndo?: () => void): void {
  store.replaceAll(bundle.workbook);
  hub.replaceProject(bundle.project, bundle.activeScenarioId ?? undefined);
  if (bundle.captures !== undefined) hub.importCaptures(bundle.captures);
  hub.restoreEvents(bundle.events);
  clearUndo?.();
}
