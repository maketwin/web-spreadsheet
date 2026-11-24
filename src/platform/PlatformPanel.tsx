import { Tooltip } from 'antd';
import { useEffect, useRef, useState, type FC, type ReactNode } from 'react';
import type { ApiInterface, ApiRule, Scenario, TimelineEvent } from './types';
import type { MockHub } from './MockHub';
import type { CommandManager } from '../commands/CommandManager';
import type { Store } from '../store/Store';
import { applyBundle, exportBundleFile, importBundleFile } from './bundle';
import { buildDependencyMap, type CellDep } from './deps';
import {
  InterfaceEditorModal,
  RuleEditorModal,
  ScenarioEditorModal,
  draftToInterface,
  draftToRule,
  draftToScenario,
  interfaceToDraft,
  ruleToDraft,
  scenarioToDraft,
  type InterfaceDraft,
  type RuleDraft,
  type ScenarioDraft,
} from './editors';
import { importOpenApiFile } from './openapi';
import { clearPersistedProject, exportProjectFile, importProjectFile } from './persistence';
import { replayTimeline, type ReplayReport } from './replay';
import './panel.css';

/** 出参预览：截断的 JSON，悬浮看全量。 */
function preview(value: unknown, max = 56): ReactNode {
  const text = value === undefined ? 'undefined' : JSON.stringify(value);
  const shown = text.length > max ? `${text.slice(0, max)}…` : text;
  return (
    <Tooltip title={<span style={{ whiteSpace: 'pre-wrap', maxWidth: 380, display: 'block' }}>{text}</span>}>
      <code className="ssp-code ssp-ellipsis">{shown}</code>
    </Tooltip>
  );
}

function matcherSummary(rule: ApiRule): string {
  const entries = Object.entries(rule.matchers.query ?? {});
  if (entries.length === 0) return '任意入参';
  return entries.map(([k, v]) => (v === '*' ? `${k}=*` : `${k}=${v}`)).join(' ');
}

/** 两步确认的小按钮：第一次点击武装，2.5 秒内再点执行。 */
function DangerButton({ label, onConfirm }: { label: string; onConfirm: () => void }): ReactNode {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 2500);
    return () => clearTimeout(timer);
  }, [armed]);
  return (
    <button
      type="button"
      className={`ssp-mini${armed ? ' ssp-mini--armed' : ''}`}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else {
          setArmed(true);
        }
      }}
    >
      {armed ? '确认?' : label}
    </button>
  );
}

function RuleRow({ hub, rule, active, onEdit }: { hub: MockHub; rule: ApiRule; active: boolean; onEdit: () => void }): ReactNode {
  const hits = hub.ruleHits(rule.id);
  const capture = hub.captureOf(rule.interfaceId);
  const probPct = Math.round((rule.faultProbability ?? 1) * 100);
  return (
    <div className={`ssp-rule${active ? ' ssp-rule--active' : ''}`}>
      <div className="ssp-rule-main">
        <span className="ssp-pri">P{rule.priority}</span>
        <span className="ssp-rule-name">{rule.name}</span>
        {active && <span className="ssp-chip ssp-chip--ok">场景生效</span>}
        {!rule.enabled && <span className="ssp-chip">已禁用</span>}
        {rule.fault !== 'none' && (
          <span className="ssp-chip ssp-chip--bad">
            {rule.fault === 'timeout' ? '超时' : '故障 500'}{probPct < 100 ? ` ${probPct}%` : ''}
          </span>
        )}
        {rule.delayMs !== undefined && rule.delayMs > 0 && <span className="ssp-chip">⏱{rule.delayMs}ms</span>}
        {rule.response.kind === 'template' && <span className="ssp-chip ssp-chip--tpl">模板</span>}
        {rule.response.kind === 'script' && <span className="ssp-chip ssp-chip--tpl">脚本</span>}
        {rule.response.kind === 'capture' && (
          <Tooltip title={capture === undefined ? '尚未同步真实数据' : `已捕获 ${new Date(capture.ts).toLocaleTimeString('zh-CN', { hour12: false })} · ${capture.url}`}>
            <span className={`ssp-chip ${capture === undefined ? 'ssp-chip--bad' : 'ssp-chip--cap'}`}>真实捕获{capture === undefined ? '·未同步' : ''}</span>
          </Tooltip>
        )}
        {hits > 0 && <span className="ssp-hits">×{hits}</span>}
        <span className="ssp-rule-actions">
          <button type="button" className="ssp-mini" onClick={onEdit}>编辑</button>
          <DangerButton label="删除" onConfirm={() => hub.removeRule(rule.id)} />
        </span>
      </div>
      <div className="ssp-rule-meta">
        <span className="ssp-dim">匹配 </span>
        <code className="ssp-code">{matcherSummary(rule)}</code>
        {(rule.response.kind === 'static' || rule.response.kind === 'template') && (
          <>
            <span className="ssp-dim"> 出参 </span>
            {preview(rule.response.body)}
          </>
        )}
        {rule.response.kind === 'script' && (
          <>
            <span className="ssp-dim"> 脚本 </span>
            {preview(String(rule.response.body), 40)}
          </>
        )}
      </div>
    </div>
  );
}

function InterfaceCard({
  hub,
  iface,
  deps,
  onEdit,
  onAddRule,
  onEditRule,
  onSync,
  syncing,
}: {
  hub: MockHub;
  iface: ApiInterface;
  deps: readonly CellDep[];
  onEdit: () => void;
  onAddRule: () => void;
  onEditRule: (rule: ApiRule) => void;
  onSync: () => void;
  syncing: boolean;
}): ReactNode {
  const rules = hub.project.rules
    .filter((r) => r.interfaceId === iface.id)
    .sort((a, b) => a.priority - b.priority);
  const pickedId = hub.activeScenario?.rules[iface.id];
  const shownDeps = deps.slice(0, 6);
  return (
    <div className="ssp-card">
      <div className="ssp-card-head">
        <span className={`ssp-method ssp-method--${iface.method.toLowerCase()}`}>{iface.method}</span>
        <span className="ssp-card-title">{iface.name}</span>
        <code className="ssp-code ssp-ellipsis">{iface.urlPattern}</code>
        <span className="ssp-card-actions">
          {iface.upstream !== undefined && (
            <button type="button" className="ssp-mini" disabled={syncing} onClick={onSync}>{syncing ? '同步中…' : '同步真实'}</button>
          )}
          <button type="button" className="ssp-mini" onClick={onEdit}>编辑</button>
          <DangerButton label="删除" onConfirm={() => hub.removeInterface(iface.id)} />
        </span>
      </div>
      {iface.upstream !== undefined && <div className="ssp-dim ssp-upstream">上游 {iface.upstream}</div>}
      {(iface.assertions?.length ?? 0) > 0 && (
        <div className="ssp-dim ssp-upstream">
          断言 {iface.assertions?.map((a) => `${a.key}${a.equals !== undefined ? `=${a.equals}` : a.oneOf !== undefined ? `∈[${a.oneOf.join('|')}]` : ' 存在'}`).join('；')}
        </div>
      )}
      {deps.length > 0 && (
        <div className="ssp-dim ssp-upstream">
          依赖 {shownDeps.map((d) => (
            <Tooltip key={`${d.sheetName}!${d.ref}`} title={`${d.sheetName} 工作表`}>
              <span className="ssp-chip ssp-chip--dep">{d.ref}</span>
            </Tooltip>
          ))}
          {deps.length > shownDeps.length ? ` +${deps.length - shownDeps.length}` : ''}
        </div>
      )}
      {rules.map((rule) => (
        <RuleRow key={rule.id} hub={hub} rule={rule} active={rule.id === pickedId} onEdit={() => onEditRule(rule)} />
      ))}
      <button type="button" className="ssp-add" onClick={onAddRule}>＋ 规则</button>
    </div>
  );
}

function ScenarioCard({ hub, scenario, onEdit }: { hub: MockHub; scenario: Scenario; onEdit: () => void }): ReactNode {
  const isActive = hub.activeScenario?.id === scenario.id;
  return (
    <div className={`ssp-card ssp-scenario${isActive ? ' ssp-scenario--active' : ''}`}>
      <div className="ssp-card-head">
        <span className="ssp-card-title">{scenario.name}</span>
        <span className="ssp-card-actions">
          {isActive
            ? <span className="ssp-chip ssp-chip--ok">当前场景</span>
            : <button type="button" className="ssp-btn" onClick={() => hub.applyScenario(scenario.id)}>应用</button>}
          <button type="button" className="ssp-mini" onClick={onEdit}>编辑</button>
          <DangerButton label="删除" onConfirm={() => hub.removeScenario(scenario.id)} />
        </span>
      </div>
      <div className="ssp-dim">{scenario.description}</div>
      <div className="ssp-scenario-map">
        {Object.entries(scenario.rules).map(([ifaceId, ruleId]) => (
          <span key={ifaceId} className="ssp-chip">
            {hub.interfaceById(ifaceId)?.name ?? ifaceId} → {hub.ruleById(ruleId)?.name ?? ruleId}
          </span>
        ))}
      </div>
    </div>
  );
}

function timeOf(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false });
}

/** 导入失败提示条（无 message 上下文时的轻提示）。 */
function showImportError(err: unknown): void {
  const bar = document.createElement('div');
  bar.textContent = `导入失败：${err instanceof Error ? err.message : String(err)}`;
  bar.className = 'ssp-import-error';
  document.body.append(bar);
  setTimeout(() => bar.remove(), 4000);
}

/** 操作值显示：空单元格显示 ∅，长值（公式）截断，悬浮看全量。 */
function opValue(value: string | null): ReactNode {
  if (value === null) return null;
  const shown = value === '' ? '∅' : `"${value.length > 22 ? `${value.slice(0, 22)}…` : value}"`;
  return (
    <Tooltip title={value === '' ? '（空）' : value}>
      <span className="ssp-op-val">{shown}</span>
    </Tooltip>
  );
}

function TimelineRow({ hub, event, onFromTraffic, onReplayTo }: { hub: MockHub; event: TimelineEvent; onFromTraffic: (seq: number) => void; onReplayTo: (seq: number) => void }): ReactNode {
  if (event.kind === 'op') {
    return (
      <div className="ssp-tl-row">
        <span className="ssp-seq">#{event.seq}</span>
        <span className="ssp-dot ssp-dot--op" title="操作" />
        <span className="ssp-tl-main">
          <code className="ssp-tl-type">{event.type}</code>
          {event.target !== null && <b className="ssp-op-target">{event.target}</b>}
          {event.target !== null && event.before !== null && (
            <span className="ssp-op-change">
              {opValue(event.before)}
              <span className="ssp-dim"> → </span>
              {opValue(event.after)}
            </span>
          )}
          {event.via !== 'user' && (
            <span className={`ssp-chip${event.via === 'replay' ? ' ssp-chip--tpl' : ''}`}>
              {event.via === 'undo' ? '撤销' : event.via === 'redo' ? '重做' : '回放'}
            </span>
          )}
          {event.via !== 'replay' && (
            <Tooltip title="从头回放到这一步">
              <button type="button" className="ssp-mini" onClick={() => onReplayTo(event.seq)}>▶到这</button>
            </Tooltip>
          )}
        </span>
        <span className="ssp-tl-time">{timeOf(event.ts)}</span>
      </div>
    );
  }
  if (event.kind === 'scenario') {
    return (
      <div className="ssp-tl-row">
        <span className="ssp-seq">#{event.seq}</span>
        <span className="ssp-dot ssp-dot--scenario" title="场景切换" />
        <span className="ssp-tl-main">
          <span className="ssp-dim">切换场景 </span>
          <b>{hub.scenarioById(event.from)?.name ?? '—'}</b>
          <span className="ssp-dim"> → </span>
          <b>{hub.scenarioById(event.to)?.name}</b>
          <Tooltip title="从头回放到这一步">
            <button type="button" className="ssp-mini" onClick={() => onReplayTo(event.seq)}>▶到这</button>
          </Tooltip>
        </span>
        <span className="ssp-tl-time">{timeOf(event.ts)}</span>
      </div>
    );
  }
  const rule = hub.ruleById(event.matchedRuleId);
  const bad = event.source === 'miss' || event.fault !== 'none' || event.violations.length > 0;
  const convertible = hub.ruleFromTraffic(event.seq) !== undefined;
  return (
    <div className="ssp-tl-row">
      <span className="ssp-seq">#{event.seq}</span>
      <span className={`ssp-dot${bad ? ' ssp-dot--fault' : ' ssp-dot--traffic'}`} title={event.source === 'capture' ? '真实捕获' : '接口调用'} />
      <span className="ssp-tl-main">
        <code className="ssp-code ssp-ellipsis">{event.url}</code>
        {event.delayMs !== null && <span className="ssp-chip">⏱{event.delayMs}ms</span>}
        {event.source === 'capture'
          ? <span className="ssp-chip ssp-chip--cap">真实捕获</span>
          : rule !== undefined
            ? <span className="ssp-dim"> → {rule.name}{event.fault === 'error' ? '（500）' : event.fault === 'timeout' ? '（超时）' : ''}</span>
            : <span className="ssp-chip ssp-chip--bad">未命中</span>}
        {event.violations.map((v, i) => (
          <Tooltip key={i} title={v}>
            <span className="ssp-chip ssp-chip--bad ssp-ellipsis">⚠ {v.slice(0, 18)}{v.length > 18 ? '…' : ''}</span>
          </Tooltip>
        ))}
        {event.causedBy !== null && <span className="ssp-cause">⇱ #{event.causedBy}</span>}
        {convertible && <Tooltip title="把这次响应固化为此接口的 static 规则"><button type="button" className="ssp-mini" onClick={() => onFromTraffic(event.seq)}>转规则</button></Tooltip>}
      </span>
      <span className="ssp-tl-time">{timeOf(event.ts)}</span>
    </div>
  );
}

type TabKey = 'interfaces' | 'scenarios' | 'timeline';
type KindFilter = 'op' | 'traffic' | 'scenario';
type EditorState =
  | { readonly kind: 'iface'; readonly initial: InterfaceDraft }
  | { readonly kind: 'rule'; readonly interfaceId: string; readonly interfaceName: string; readonly initial: RuleDraft }
  | { readonly kind: 'scenario'; readonly initial: ScenarioDraft }
  | null;

/** 平台控制台：接口/规则、场景、统一时间线的可编辑视图，订阅 MockHub 刷新。 */
export const PlatformPanel: FC<{
  readonly hub: MockHub;
  /** 回放与复现包需要：重建命令直接作用于 store、导出工作簿快照。 */
  readonly store: Store;
  readonly cmdManager?: CommandManager;
}> = ({ hub, store, cmdManager }) => {
  const [tick, setTick] = useState(0);
  const [tab, setTab] = useState<TabKey>('interfaces');
  const [kinds, setKinds] = useState<readonly KindFilter[]>(['op', 'traffic', 'scenario']);
  const [editor, setEditor] = useState<EditorState>(null);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [report, setReport] = useState<ReplayReport | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** 步进游标：下一个待回放事件的起点 seq；null = 从头。 */
  const [stepNext, setStepNext] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const bundleRef = useRef<HTMLInputElement>(null);
  const openApiRef = useRef<HTMLInputElement>(null);
  useEffect(() => hub.onChange(() => setTick((n) => n + 1)), [hub]);
  // tick 只负责在 hub 通知后触发重渲染
  void tick;
  const project = hub.project;
  const events = hub.timeline.filter((e) => kinds.includes(e.kind)).slice(-200).reverse();
  const trafficCount = hub.timeline.reduce((n, e) => (e.kind === 'traffic' ? n + 1 : n), 0);
  const syncAll = syncing === '*';
  const depMap = buildDependencyMap(store, hub);

  /** 单步：回放游标起的下一个可回放事件（场景或带载荷操作）。 */
  const stepOnce = (): void => {
    const from = stepNext ?? 1;
    const next = hub.timeline.find((e) => e.seq >= from && (e.kind === 'scenario' || (e.kind === 'op' && e.via !== 'replay')));
    if (next === undefined) {
      setNotice('没有更多可回放的步骤了（清空时间线后重新录制）');
      return;
    }
    const r = replayTimeline(hub, store, { fromSeq: from, toSeq: next.seq });
    setStepNext(next.seq + 1);
    setReport(r);
  };
  const replayAll = (): void => {
    setStepNext(null);
    setReport(replayTimeline(hub, store));
  };

  const openInterfaceEditor = (iface?: ApiInterface): void => setEditor({ kind: 'iface', initial: interfaceToDraft(iface) });
  const openRuleEditor = (interfaceId: string, interfaceName: string, rule?: ApiRule): void =>
    setEditor({ kind: 'rule', interfaceId, interfaceName, initial: ruleToDraft(rule) });
  const openScenarioEditor = (scenario?: Scenario): void => setEditor({ kind: 'scenario', initial: scenarioToDraft(scenario) });

  const syncInterface = async (id: string): Promise<void> => {
    setSyncing(id);
    try {
      await hub.syncUpstream([id]);
    } finally {
      setSyncing(null);
    }
  };

  const tabs: ReadonlyArray<{ key: TabKey; label: string; count: number }> = [
    { key: 'interfaces', label: '接口', count: project.interfaces.length },
    { key: 'scenarios', label: '场景', count: project.scenarios.length },
    { key: 'timeline', label: '时间线', count: hub.timeline.length },
  ];

  return (
    <div className="ssp-panel">
      <header className="ssp-header">
        <span className="ssp-logo" />
        <span className="ssp-title">Mock 接管平台</span>
        <span className="ssp-dim ssp-ellipsis">{project.name}</span>
        <span className="ssp-header-actions">
          <button type="button" className="ssp-mini" onClick={() => exportProjectFile(hub)}>导出</button>
          <button type="button" className="ssp-mini" onClick={() => fileRef.current?.click()}>导入</button>
          <DangerButton
            label="重置"
            onConfirm={() => {
              clearPersistedProject();
              window.location.reload();
            }}
          />
          <input
            ref={fileRef}
            type="file"
            accept=".json,.ssp.json,application/json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file === undefined) return;
              void importProjectFile(file)
                .then(({ project: imported, activeScenarioId }) => hub.replaceProject(imported, activeScenarioId ?? undefined))
                .catch((err: unknown) => showImportError(err));
            }}
          />
        </span>
      </header>
      <div className="ssp-stats ssp-dim">
        {project.interfaces.length} 接口 · {project.rules.length} 规则 · {project.scenarios.length} 场景 · {trafficCount} 次调用
      </div>
      <nav className="ssp-tabbar">
        {tabs.map(({ key, label, count }) => (
          <button
            key={key}
            type="button"
            className={`ssp-tab${tab === key ? ' ssp-tab--active' : ''}`}
            onClick={() => setTab(key)}
          >
            {label}
            {count > 0 && <span className="ssp-tab-count">{count}</span>}
          </button>
        ))}
      </nav>
      <div className="ssp-body">
        {tab === 'interfaces' && (
          <>
            <div className="ssp-toolbar">
              <button type="button" className="ssp-btn" onClick={() => openInterfaceEditor()}>＋ 接口</button>
              <button type="button" className="ssp-btn ssp-btn--ghost" onClick={() => openApiRef.current?.click()}>导入 OpenAPI</button>
              <input
                ref={openApiRef}
                type="file"
                accept=".json,.yaml,application/json"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file === undefined) return;
                  void importOpenApiFile(file)
                    .then(({ interfaces: imported, rules, skipped }) => {
                      for (const i of imported) hub.upsertInterface(i);
                      for (const r of rules) hub.upsertRule(r);
                      setNotice(`OpenAPI 导入：${imported.length} 个接口${skipped.length > 0 ? `，跳过 ${skipped.length} 个不支持的方法` : ''}`);
                    })
                    .catch((err: unknown) => showImportError(err));
                }}
              />
              <button
                type="button"
                className="ssp-btn ssp-btn--ghost"
                disabled={syncAll || project.interfaces.every((i) => i.upstream === undefined)}
                onClick={() => {
                  setSyncing('*');
                  void hub.syncUpstream().finally(() => setSyncing(null));
                }}
              >
                {syncAll ? '同步中…' : '同步全部真实数据'}
              </button>
            </div>
            {notice !== null && <div className="ssp-replay-banner">{notice}</div>}
            {project.interfaces.map((iface) => (
              <InterfaceCard
                key={iface.id}
                hub={hub}
                iface={iface}
                deps={depMap.byInterface.get(iface.id) ?? []}
                syncing={syncing === iface.id || syncAll}
                onEdit={() => openInterfaceEditor(iface)}
                onAddRule={() => openRuleEditor(iface.id, iface.name)}
                onEditRule={(rule) => openRuleEditor(iface.id, iface.name, rule)}
                onSync={() => void syncInterface(iface.id)}
              />
            ))}
          </>
        )}
        {tab === 'scenarios' && (
          <>
            <div className="ssp-toolbar">
              <button type="button" className="ssp-btn" onClick={() => openScenarioEditor()}>＋ 场景</button>
            </div>
            {project.scenarios.map((s) => (
              <ScenarioCard key={s.id} hub={hub} scenario={s} onEdit={() => openScenarioEditor(s)} />
            ))}
          </>
        )}
        {tab === 'timeline' && (
          <>
            <div className="ssp-tl-toolbar">
              {([['op', '操作'], ['traffic', '接口'], ['scenario', '场景']] as const).map(([kind, label]) => (
                <button
                  key={kind}
                  type="button"
                  className={`ssp-chip-btn${kinds.includes(kind) ? ' ssp-chip-btn--on' : ''}`}
                  onClick={() => setKinds((cur) => (cur.includes(kind) ? cur.filter((k) => k !== kind) : [...cur, kind]))}
                >
                  {label}
                </button>
              ))}
              <button type="button" className="ssp-chip-btn" onClick={() => hub.clearTimeline()}>清空</button>
              <span className="ssp-tl-spacer" />
              <button
                type="button"
                className="ssp-chip-btn ssp-chip-btn--replay"
                onClick={() => stepOnce()}
                title="回放下一个事件（从上次停点继续）"
              >
                ⏭ 单步
              </button>
              <button
                type="button"
                className="ssp-chip-btn ssp-chip-btn--replay"
                onClick={() => replayAll()}
                title="按 seq 重演时间线里的场景与操作，接口走当前 mock 规则；逐步与记录值比对"
              >
                ▶ 回放
              </button>
              <button type="button" className="ssp-chip-btn" onClick={() => exportBundleFile(hub, store)}>导出复现包</button>
              <button type="button" className="ssp-chip-btn" onClick={() => bundleRef.current?.click()}>导入复现包</button>
              <input
                ref={bundleRef}
                type="file"
                accept=".json,application/json"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file === undefined) return;
                  void importBundleFile(file)
                    .then((b) => {
                      applyBundle(hub, store, b, cmdManager === undefined ? undefined : () => cmdManager.clear());
                      setReport(null);
                    })
                    .catch((err: unknown) => showImportError(err));
                }}
              />
            </div>
            {report !== null && (
              <div className={`ssp-replay-banner${report.deviations.length > 0 ? ' ssp-replay-banner--bad' : ''}`}>
                回放完成：{report.replayed}/{report.total} 步重演，{report.skipped} 步跳过，
                {report.deviations.length > 0
                  ? `${report.deviations.length} 处偏差 ↓`
                  : '与记录完全一致'}
                {report.deviations.map((d) => (
                  <div key={d.seq} className="ssp-replay-dev">
                    #{d.seq} {d.target ?? ''}：期望 {d.expected === null ? 'null' : `"${d.expected}"`}，实际 {d.actual === null ? 'null' : `"${d.actual}"`}
                  </div>
                ))}
              </div>
            )}
            {events.length === 0
              ? <div className="ssp-empty ssp-dim">暂无记录 — 在表格里编辑，或切换一个场景</div>
              : events.map((event) => (
                  <TimelineRow
                    key={event.seq}
                    hub={hub}
                    event={event}
                    onReplayTo={(seq) => {
                      setStepNext(null);
                      setReport(replayTimeline(hub, store, { toSeq: seq }));
                    }}
                    onFromTraffic={(seq) => {
                      const draft = hub.ruleFromTraffic(seq);
                      if (draft !== undefined) {
                        const iface = hub.interfaceById(draft.interfaceId);
                        setEditor({ kind: 'rule', interfaceId: draft.interfaceId, interfaceName: iface?.name ?? draft.interfaceId, initial: ruleToDraft(draft) });
                      }
                    }}
                  />
                ))}
          </>
        )}
      </div>

      {editor?.kind === 'iface' && (
        <InterfaceEditorModal
          open
          initial={editor.initial}
          onCancel={() => setEditor(null)}
          onSave={(draft: InterfaceDraft) => {
            hub.upsertInterface(draftToInterface(draft));
            setEditor(null);
          }}
        />
      )}
      {editor?.kind === 'rule' && (
        <RuleEditorModal
          open
          initial={editor.initial}
          interfaceName={editor.interfaceName}
          onCancel={() => setEditor(null)}
          onSave={(draft: RuleDraft) => {
            try {
              hub.upsertRule(draftToRule(draft, editor.interfaceId));
              setEditor(null);
            } catch {
              // JSON 校验已在表单层拦截，这里兜底不关闭
            }
          }}
        />
      )}
      {editor?.kind === 'scenario' && (
        <ScenarioEditorModal
          open
          initial={editor.initial}
          interfaces={project.interfaces}
          rules={project.rules}
          onCancel={() => setEditor(null)}
          onSave={(draft: ScenarioDraft) => {
            hub.upsertScenario(draftToScenario(draft));
            setEditor(null);
          }}
        />
      )}
    </div>
  );
};
