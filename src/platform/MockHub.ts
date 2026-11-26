import { matchInterface, parseUrl, pickRule, renderTemplate, runScript, seededFlip } from './RuleEngine';
import type { ApiInterface, ApiRule, HttpMethod, MockProject, OpVia, ReplayPayload, Scenario, TimelineEvent, TrafficSource } from './types';

/** 未命中/故障时接口桥返回的错误标记。展示为单元格文本 #API!。 */
export const API_ERROR = '#API!';

function isCaptureLike(v: unknown): v is Capture {
  return typeof v === 'object' && v !== null && 'url' in v && 'body' in v && 'ts' in v;
}

export interface Capture {
  readonly url: string;
  readonly body: unknown;
  readonly ts: number;
}

export interface SyncReport {
  readonly interfaceId: string;
  readonly ok: boolean;
  readonly detail: string;
}

type ChangeListener = () => void;
/** 数据刷新回调（真实捕获到货）——宿主应在这里做全量重算。 */
type DataRefreshListener = () => void;

/**
 * Mock 平台状态中心：接口/规则/场景的可变集合 + 三条记录流 + 因果锚点 +
 * 真实上游捕获。所有变更方法通知 UI（microtask 批量）并使持久化快照失效。
 */
export class MockHub {
  private projectName: string;
  private readonly ifaceList: ApiInterface[] = [];
  private readonly ruleList: ApiRule[] = [];
  private readonly scenarioList: Scenario[] = [];
  private currentScenarioId: string | null = null;
  private readonly log: TimelineEvent[] = [];
  private nextSeq = 1;
  /** 因果锚点：当前正在执行的操作/场景切换的 seq，流量记录的 causedBy 指向它。 */
  private currentCause: number | null = null;
  private readonly hitCounts = new Map<string, number>();
  /** 真实捕获快照：interfaceId -> 最近一次上游响应。 */
  private readonly captures = new Map<string, Capture>();
  /** 每个接口最近一次被公式请求的 URL（含 query）——同步上游时复用其入参。 */
  private readonly lastRequestUrl = new Map<string, string>();
  private readonly changeListeners = new Set<ChangeListener>();
  private readonly refreshListeners = new Set<DataRefreshListener>();
  private notifyQueued = false;

  public constructor(project: MockProject) {
    this.projectName = project.name;
    this.ifaceList.push(...project.interfaces);
    this.ruleList.push(...project.rules);
    this.scenarioList.push(...project.scenarios);
    this.currentScenarioId = project.scenarios[0]?.id ?? null;
  }

  public get project(): MockProject {
    return {
      name: this.projectName,
      interfaces: [...this.ifaceList],
      rules: [...this.ruleList],
      scenarios: [...this.scenarioList],
    };
  }

  public get activeScenario(): Scenario | undefined {
    return this.currentScenarioId === null ? undefined : this.scenarioList.find((s) => s.id === this.currentScenarioId);
  }

  public get activeScenarioId(): string | null {
    return this.currentScenarioId;
  }

  public get timeline(): readonly TimelineEvent[] {
    return this.log;
  }

  public scenarioById(id: string | null): Scenario | undefined {
    return id === null ? undefined : this.scenarioList.find((s) => s.id === id);
  }

  public interfaceById(id: string): ApiInterface | undefined {
    return this.ifaceList.find((i) => i.id === id);
  }

  public ruleById(id: string | null): ApiRule | undefined {
    return id === null ? undefined : this.ruleList.find((r) => r.id === id);
  }

  public ruleHits(ruleId: string): number {
    return this.hitCounts.get(ruleId) ?? 0;
  }

  public captureOf(interfaceId: string): Capture | undefined {
    return this.captures.get(interfaceId);
  }

  /** 捕获快照导出/导入（持久化用；URL 与时间戳随快照一起保存）。 */
  public exportCaptures(): Record<string, Capture> {
    return Object.fromEntries(this.captures);
  }

  public importCaptures(entries: Readonly<Record<string, unknown>>): void {
    for (const [id, cap] of Object.entries(entries)) {
      if (isCaptureLike(cap)) this.captures.set(id, cap);
    }
    this.changed();
  }

  /** 捕获快照整体替换（复现包应用失败时的回滚入口）：不在快照里的接口一并清除。 */
  public replaceCaptures(entries: Readonly<Record<string, Capture>>): void {
    this.captures.clear();
    for (const [id, cap] of Object.entries(entries)) this.captures.set(id, cap);
  }

  // ---- 可变模型：接口 / 规则 / 场景 ----

  /** 新增或按 id 替换接口。 */
  public upsertInterface(iface: ApiInterface): void {
    const idx = this.ifaceList.findIndex((i) => i.id === iface.id);
    if (idx === -1) this.ifaceList.push(iface);
    else this.ifaceList[idx] = iface;
    this.changed();
  }

  /** 删除接口：其规则、场景映射、捕获快照一并清理。 */
  public removeInterface(id: string): void {
    const idx = this.ifaceList.findIndex((i) => i.id === id);
    if (idx === -1) return;
    this.ifaceList.splice(idx, 1);
    for (let i = this.ruleList.length - 1; i >= 0; i -= 1) {
      if (this.ruleList[i]?.interfaceId === id) this.ruleList.splice(i, 1);
    }
    // Scenario.rules 是只读记录——用整体替换而不是原地 delete
    for (let i = 0; i < this.scenarioList.length; i += 1) {
      const s = this.scenarioList[i];
      if (s !== undefined && id in s.rules) {
        const rest = { ...s.rules };
        delete rest[id];
        this.scenarioList[i] = { ...s, rules: rest };
      }
    }
    this.captures.delete(id);
    this.lastRequestUrl.delete(id);
    this.changed();
  }

  /** 新增或按 id 替换规则。 */
  public upsertRule(rule: ApiRule): void {
    const idx = this.ruleList.findIndex((r) => r.id === rule.id);
    if (idx === -1) this.ruleList.push(rule);
    else this.ruleList[idx] = rule;
    this.changed();
  }

  /** 删除规则：引用它的场景映射同步摘除（该接口回退到优先级匹配）。 */
  public removeRule(id: string): void {
    const idx = this.ruleList.findIndex((r) => r.id === id);
    if (idx === -1) return;
    this.ruleList.splice(idx, 1);
    for (let i = 0; i < this.scenarioList.length; i += 1) {
      const s = this.scenarioList[i];
      if (s !== undefined && Object.values(s.rules).includes(id)) {
        const rest = Object.fromEntries(Object.entries(s.rules).filter(([, ruleId]) => ruleId !== id));
        this.scenarioList[i] = { ...s, rules: rest };
      }
    }
    this.hitCounts.delete(id);
    this.changed();
  }

  public upsertScenario(scenario: Scenario): void {
    const idx = this.scenarioList.findIndex((s) => s.id === scenario.id);
    if (idx === -1) this.scenarioList.push(scenario);
    else this.scenarioList[idx] = scenario;
    this.changed();
  }

  public removeScenario(id: string): void {
    const idx = this.scenarioList.findIndex((s) => s.id === id);
    if (idx === -1) return;
    this.scenarioList.splice(idx, 1);
    if (this.currentScenarioId === id) this.currentScenarioId = this.scenarioList[0]?.id ?? null;
    this.changed();
  }

  /** 整体替换项目（导入/恢复），项目名一并更新。不产生操作记录，场景切到 activeScenarioId。 */
  public replaceProject(project: MockProject, activeScenarioId?: string): void {
    this.projectName = project.name;
    this.ifaceList.length = 0;
    this.ifaceList.push(...project.interfaces);
    this.ruleList.length = 0;
    this.ruleList.push(...project.rules);
    this.scenarioList.length = 0;
    this.scenarioList.push(...project.scenarios);
    const target = activeScenarioId ?? project.scenarios[0]?.id ?? null;
    this.currentScenarioId = this.scenarioList.some((s) => s.id === target) ? target : null;
    this.changed();
  }

  /** 流量转规则：把一次命中的响应固化为 static 规则（入参匹配条件一并带过来）。 */
  public ruleFromTraffic(seq: number): ApiRule | undefined {
    const event = this.log.find((e) => e.seq === seq);
    if (event === undefined || event.kind !== 'traffic') return undefined;
    if (event.matchedRuleId === null || event.response === API_ERROR || event.response === null) return undefined;
    const iface = this.interfaceById(event.interfaceId);
    if (iface === undefined) return undefined;
    const base = this.ruleList
      .filter((r) => r.interfaceId === iface.id)
      .reduce((max, r) => Math.max(max, r.priority), 0);
    return {
      id: `rule-${seq}-${Date.now().toString(36)}`,
      interfaceId: iface.id,
      name: `来自流量 #${seq}`,
      matchers: Object.keys(event.query).length > 0 ? { query: { ...event.query } } : {},
      response: { kind: 'static', body: event.response },
      fault: 'none',
      enabled: true,
      priority: base + 10,
    };
  }

  // ---- 接口桥与记录流 ----

  /**
   * 接口桥入口（公式函数调这里）：定位接口 → 场景/优先级选规则 → 渲染出参
   * → 注入故障 → 校验入参断言 → 记流量（挂 causedBy）。同步返回；真实网络
   * 走 syncUpstream 的捕获快照，不在这里发请求。
   */
  public call(method: HttpMethod, url: string): unknown {
    const { path, query } = parseUrl(url);
    const match = matchInterface(this.ifaceList, method, path);
    const rule = match === undefined ? undefined : pickRule(match.iface, this.ruleList, this.activeScenario, query);
    const hitIndex = rule === undefined ? 0 : (this.hitCounts.get(rule.id) ?? 0) + 1;
    // 概率故障：稳定种子（规则#第N次命中）——回放时命中序列重建，结果可复现
    const fires = rule !== undefined && rule.fault !== 'none'
      && seededFlip(`${rule.id}#${hitIndex}`) < (rule.faultProbability ?? 1);
    const effectiveFault = fires ? rule?.fault ?? 'none' : 'none';
    const source: TrafficSource = rule === undefined ? 'miss' : rule.response.kind === 'capture' ? 'capture' : 'rule';
    const violations: string[] = [];
    let body: unknown;
    if (rule === undefined || effectiveFault !== 'none') {
      body = match !== undefined && rule === undefined && match.iface.fallback === 'empty' ? null : API_ERROR;
    } else if (rule.response.kind === 'capture') {
      body = match === undefined ? API_ERROR : this.captures.get(match.iface.id)?.body ?? API_ERROR;
    } else if (rule.response.kind === 'script') {
      const result = runScript(String(rule.response.body), { query, path: match?.params ?? {} });
      if (result.ok) {
        body = result.body;
      } else {
        body = API_ERROR;
        violations.push(`脚本错误：${result.error ?? '未知'}`);
      }
    } else if (rule.response.kind === 'template' && match !== undefined) {
      body = renderTemplate(rule.response.body, { query, path: match.params });
    } else {
      body = rule.response.body;
    }
    if (match !== undefined) {
      this.lastRequestUrl.set(match.iface.id, url);
      // 入参断言：不影响出参，只验行为
      for (const assertion of match.iface.assertions ?? []) {
        const actual = query[assertion.key];
        if (assertion.equals !== undefined && actual !== assertion.equals) {
          violations.push(`断言 ${assertion.key}=${actual ?? '（缺失）'}，期望 ${assertion.equals}`);
        } else if (assertion.oneOf !== undefined && !assertion.oneOf.includes(actual ?? '')) {
          violations.push(`断言 ${assertion.key}=${actual ?? '（缺失）'}，期望 ∈ [${assertion.oneOf.join(' | ')}]`);
        } else if (assertion.equals === undefined && assertion.oneOf === undefined && !(assertion.key in query)) {
          violations.push(`断言缺少参数 ${assertion.key}`);
        }
      }
    }
    if (rule !== undefined) this.hitCounts.set(rule.id, hitIndex);
    this.log.push({
      seq: this.nextSeq++,
      ts: Date.now(),
      kind: 'traffic',
      interfaceId: match?.iface.id ?? '',
      url,
      query,
      matchedRuleId: rule?.id ?? null,
      source,
      scenarioId: this.currentScenarioId,
      fault: effectiveFault,
      delayMs: rule?.delayMs ?? null,
      violations,
      response: body,
      causedBy: this.currentCause,
    });
    this.scheduleNotify();
    return body;
  }

  /** 操作开始：记操作事件并打开因果窗口，返回事件 seq。值摘要/重放载荷在执行后经 amendOp 补齐。
   *  undoes：撤销条目指向被撤销正向条目的 seq（缺省不写字段——旧时间线形状不变）。 */
  public openCause(type: string, via: OpVia, replay: ReplayPayload | null = null, undoes?: number): number {
    const seq = this.nextSeq++;
    this.log.push({
      seq, ts: Date.now(), kind: 'op', type, via,
      target: null, before: null, after: null, replay,
      ...(undoes !== undefined ? { undoes } : {}),
    });
    this.currentCause = seq;
    this.scheduleNotify();
    return seq;
  }

  /** 补齐操作记录的"动了哪里 + 前后值 + 可重放载荷"（命令执行前采 before、执行后采 after）。 */
  public amendOp(seq: number, target: string | null, before: string | null, after: string | null, replay: ReplayPayload | null): void {
    const idx = this.log.findIndex((e) => e.seq === seq);
    if (idx === -1) return;
    const entry = this.log[idx];
    if (entry === undefined || entry.kind !== 'op') return;
    this.log[idx] = { ...entry, target, before, after, replay };
    this.scheduleNotify();
  }

  /** 操作结束：关闭因果窗口。（嵌套命令会提前关窗，M1 已知限制。） */
  public closeCause(): void {
    this.currentCause = null;
  }

  /** 切换场景：记场景事件，场景监听器（宿主做全量重算）在因果窗口内同步执行。 */
  public applyScenario(id: string): void {
    const target = this.scenarioList.find((s) => s.id === id);
    if (target === undefined || id === this.currentScenarioId) return;
    const seq = this.nextSeq++;
    this.log.push({ seq, ts: Date.now(), kind: 'scenario', from: this.currentScenarioId, to: id });
    this.currentScenarioId = id;
    this.currentCause = seq;
    try {
      this.scenarioListeners.forEach((fn) => fn());
    } finally {
      this.currentCause = null;
    }
    this.changed();
  }

  public clearTimeline(): void {
    this.log.length = 0;
    this.hitCounts.clear();
    this.currentCause = null;
    this.scheduleNotify();
  }

  /** 用复现包里的事件流替换时间线；nextSeq 接续最大 seq，因果锚点复位。 */
  public restoreEvents(events: readonly TimelineEvent[]): void {
    this.log.length = 0;
    this.log.push(...events);
    this.nextSeq = events.reduce((max, e) => Math.max(max, e.seq), 0) + 1;
    this.currentCause = null;
    this.changed();
  }

  // ---- 真实上游同步（捕获） ----

  /**
   * 抓取接口的真实上游：URL = upstream + 最近一次请求的 query。成功后更新
   * 捕获快照并记一条 capture 流量；宿主在 onDataRefreshed 里做全量重算，
   * capture 规则的单元格随之显示真实数据。
   */
  public async syncUpstream(interfaceIds?: readonly string[]): Promise<SyncReport[]> {
    const targets = this.ifaceList.filter((i) => (interfaceIds === undefined || interfaceIds.includes(i.id)) && i.upstream !== undefined);
    const reports: SyncReport[] = [];
    for (const iface of targets) {
      const upstream = iface.upstream ?? '';
      const last = this.lastRequestUrl.get(iface.id);
      const query: Record<string, string> = last === undefined ? {} : { ...parseUrl(last).query };
      const qs = new URLSearchParams(query).toString();
      const url = qs === '' ? upstream : `${upstream}${upstream.includes('?') ? '&' : '?'}${qs}`;
      try {
        const res = await fetch(url);
        const body: unknown = await res.json().catch(() => res.text());
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        this.captures.set(iface.id, { url, body, ts: Date.now() });
        this.log.push({
          seq: this.nextSeq++,
          ts: Date.now(),
          kind: 'traffic',
          interfaceId: iface.id,
          url,
          query,
          matchedRuleId: null,
          source: 'capture',
          scenarioId: this.currentScenarioId,
          fault: 'none',
          delayMs: null,
          violations: [],
          response: body,
          causedBy: null,
        });
        reports.push({ interfaceId: iface.id, ok: true, detail: url });
      } catch (err) {
        this.log.push({
          seq: this.nextSeq++,
          ts: Date.now(),
          kind: 'traffic',
          interfaceId: iface.id,
          url,
          query,
          matchedRuleId: null,
          source: 'miss',
          scenarioId: this.currentScenarioId,
          fault: 'error',
          delayMs: null,
          violations: [`上游同步失败：${err instanceof Error ? err.message : String(err)}`],
          response: `上游同步失败：${err instanceof Error ? err.message : String(err)}`,
          causedBy: null,
        });
        reports.push({ interfaceId: iface.id, ok: false, detail: err instanceof Error ? err.message : String(err) });
      }
    }
    this.changed();
    if (reports.some((r) => r.ok)) this.refreshListeners.forEach((fn) => fn());
    return reports;
  }

  public onChange(cb: ChangeListener): () => void {
    this.changeListeners.add(cb);
    return () => this.changeListeners.delete(cb);
  }

  public onDataRefreshed(cb: DataRefreshListener): () => void {
    this.refreshListeners.add(cb);
    return () => this.refreshListeners.delete(cb);
  }

  /** 项目定义变更（接口/规则/场景增删改）——宿主应做全量重算让新规则立即生效。 */
  public onProjectChanged(cb: ChangeListener): () => void {
    this.projectListeners.add(cb);
    return () => this.projectListeners.delete(cb);
  }

  private readonly projectListeners = new Set<ChangeListener>();

  /** 场景应用回调（applyScenario 在因果窗口内同步触发）。 */
  public onScenarioApplied(cb: DataRefreshListener): () => void {
    this.scenarioListeners.add(cb);
    return () => this.scenarioListeners.delete(cb);
  }

  private readonly scenarioListeners = new Set<DataRefreshListener>();

  /** 批量通知：一次全量重算产生几十条流量，只触发一轮面板刷新。 */
  private scheduleNotify(): void {
    if (this.notifyQueued) return;
    this.notifyQueued = true;
    void Promise.resolve().then(() => {
      this.notifyQueued = false;
      this.changeListeners.forEach((fn) => fn());
    });
  }

  /** 模型变更（增删改）：立即同步通知（项目级监听器同步触发，重算不递归——流量只走 scheduleNotify）。 */
  private changed(): void {
    this.projectListeners.forEach((fn) => fn());
    this.changeListeners.forEach((fn) => fn());
    this.scheduleNotify();
  }
}
