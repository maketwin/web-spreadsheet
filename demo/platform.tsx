import { createRoot } from 'react-dom/client';
import { Spreadsheet } from '../src/components/Spreadsheet';
import { MockHub, PlatformPanel, installApiFunctions, installOperationRecorder, persistProject, restoreProject } from '../src/platform';
import { PanelErrorBoundary } from '../src/platform/PlatformPanel';
import { warnOncePersistFailed } from '../src/platform/persistence';
import { demoProject, demoStyles, demoWorkbook } from './platformDemo';

/**
 * Mock 平台演示页宿主：左侧 Excel 模拟运行时，右侧平台控制台。
 * 接线顺序有意义：函数桥先注册（工作簿装载时公式才能求值），场景/数据
 * 刷新回调里做全量重算（三条记录流由此联动）。
 */
const layout = document.getElementById('platform-layout');
if (layout === null) throw new Error('platform.html 缺少 #platform-layout');

const sheetHost = document.createElement('div');
sheetHost.className = 'platform-sheet';
sheetHost.id = 'root';
// 表格在左、控制台面板在右（DevTools 惯例）——插到 aside 之前
layout.insertBefore(sheetHost, layout.firstChild);
const panelHost = document.getElementById('platform-panel');
if (panelHost === null) throw new Error('platform.html 缺少 #platform-panel');

// 优先恢复上次保存的项目（控制台里增删改过的不丢），无存档才用演示种子
const restored = restoreProject();
const hub = new MockHub(restored?.project ?? demoProject);
if (restored?.captures !== undefined) hub.importCaptures(restored.captures);
installApiFunctions(hub);

const ss = new Spreadsheet(sheetHost, { data: demoWorkbook, theme: 'light' });
ss.mount();

// 先订阅再恢复场景：applyScenario 会同步触发场景回调做全量重算，
// 订阅晚了恢复的那次切换就没人重算，单元格停留在 mount 时的场景值
hub.onScenarioApplied(() => ss.formula.recalculateAll());
// 真实捕获到货 → capture 规则的单元格全部刷新
hub.onDataRefreshed(() => ss.formula.recalculateAll());
// 规则/接口/场景编辑保存 → 新规则立即生效（重算只产生流量，不再触发项目变更，无递归）
hub.onProjectChanged(() => ss.formula.recalculateAll());

// 恢复上次激活的场景（在订阅之后，触发一次全量重算）
if (restored?.activeScenarioId !== undefined && restored.activeScenarioId !== null) {
  hub.applyScenario(restored.activeScenarioId);
}

// 演示样式：直接写样式表与单元格 styleId，不经过命令总线（不产生操作记录）
for (const [r, c, style] of demoStyles) {
  const id = `demo:${r},${c}`;
  ss.store.setStyle(id, style);
  const cell = ss.store.getCell(r, c);
  ss.store.setCell(r, c, { text: cell?.text ?? '', ...cell, styleId: id });
}

installOperationRecorder(hub, ss.events, ss.store);

// 项目自动持久化（防抖 600ms）：接口/规则/场景/场景切换都在刷新后保留；
// 隐私模式/超配额保存失败时给一次可见提示（数据当前可用，刷新即丢）
let saveTimer: ReturnType<typeof setTimeout> | undefined;
hub.onChange(() => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!persistProject(hub)) warnOncePersistFailed();
  }, 600);
});

// 面板外层兜底：坏数据渲染崩溃时显示"重置并重新加载"而不是白屏
createRoot(panelHost).render(
  <PanelErrorBoundary>
    <PlatformPanel hub={hub} store={ss.store} cmdManager={ss.cmdManager} />
  </PanelErrorBoundary>,
);

const w = window as unknown as { __ss: Spreadsheet; __hub: MockHub };
w.__ss = ss; // debug/test handle
w.__hub = hub;
