import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_ERROR, MockHub } from '../../src/platform/MockHub';
import { draftToRule, ruleToDraft } from '../../src/platform/editors';
import { clearPersistedProject, persistProject, restoreProject, validateProject } from '../../src/platform/persistence';
import type { ApiInterface, ApiRule, MockProject, Scenario } from '../../src/platform/types';

const ifaces: readonly ApiInterface[] = [
  { id: 'kpi', name: 'KPI', method: 'GET', urlPattern: '/api/kpi', fallback: 'error', upstream: '/upstream/kpi.json' },
  { id: 'sales', name: '明细', method: 'GET', urlPattern: '/api/sales', fallback: 'error' },
];

const rule = (over: Partial<ApiRule> & Pick<ApiRule, 'id' | 'interfaceId' | 'name'>): ApiRule => ({
  matchers: {},
  response: { kind: 'static', body: { v: 1 } },
  fault: 'none',
  enabled: true,
  priority: 10,
  ...over,
});

const makeProject = (): MockProject => ({
  name: '可变项目',
  interfaces: ifaces,
  rules: [
    rule({ id: 'kpi-a', interfaceId: 'kpi', name: 'A', matchers: { query: { region: 'a' } } }),
    rule({ id: 'kpi-cap', interfaceId: 'kpi', name: '真实', response: { kind: 'capture', body: null }, priority: 50 }),
    rule({ id: 'sales-full', interfaceId: 'sales', name: '满', response: { kind: 'static', body: [['h'], [1]] } }),
  ],
  scenarios: [
    { id: 's1', name: 'S1', description: '', rules: { kpi: 'kpi-a', sales: 'sales-full' } },
    { id: 's2', name: 'S2', description: '', rules: { kpi: 'kpi-cap', sales: 'sales-full' } },
  ],
});

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('MockHub 可变模型', () => {
  it('upsertRule 生效于下一次调用；upsertInterface 同理', () => {
    const hub = new MockHub(makeProject());
    expect(hub.call('GET', '/api/kpi?region=a')).toEqual({ v: 1 });
    hub.upsertRule(rule({ id: 'kpi-a', interfaceId: 'kpi', name: 'A', matchers: { query: { region: 'a' } }, response: { kind: 'static', body: { v: 99 } } }));
    expect(hub.call('GET', '/api/kpi?region=a')).toEqual({ v: 99 });
    hub.upsertInterface({ ...ifaces[0]!, urlPattern: '/api/kpi2' });
    expect(hub.call('GET', '/api/kpi2?region=a')).toEqual({ v: 99 });
    expect(hub.call('GET', '/api/kpi?region=a')).toBe(API_ERROR); // 旧地址已无接口
  });

  it('removeRule 摘除场景映射，接口回退到优先级匹配', () => {
    const hub = new MockHub(makeProject());
    hub.removeRule('kpi-a'); // s1 钦定的规则被删
    const s1 = hub.project.scenarios.find((s) => s.id === 's1');
    expect(s1?.rules.kpi).toBeUndefined();
    // 场景未映射 → 优先级扫描：kpi-cap 通配 → 无捕获 → #API!
    expect(hub.call('GET', '/api/kpi?region=a')).toBe(API_ERROR);
  });

  it('removeInterface 级联清理规则与场景映射', () => {
    const hub = new MockHub(makeProject());
    hub.removeInterface('kpi');
    expect(hub.project.rules.some((r) => r.interfaceId === 'kpi')).toBe(false);
    expect(hub.project.scenarios.every((s) => !('kpi' in s.rules))).toBe(true);
    expect(hub.call('GET', '/api/kpi?region=a')).toBe(API_ERROR);
  });

  it('removeScenario 删除当前场景时回落到首个场景', () => {
    const hub = new MockHub(makeProject());
    hub.applyScenario('s2');
    hub.removeScenario('s2');
    expect(hub.activeScenarioId).toBe('s1');
  });

  it('upsertScenario 新增场景并应用', () => {
    const hub = new MockHub(makeProject());
    const scenario: Scenario = { id: 's3', name: 'S3', description: '', rules: { kpi: 'kpi-cap', sales: 'sales-full' } };
    hub.upsertScenario(scenario);
    hub.applyScenario('s3');
    expect(hub.activeScenario?.name).toBe('S3');
  });

  it('ruleFromTraffic：把命中的响应固化成带匹配条件的 static 规则', () => {
    const hub = new MockHub(makeProject());
    hub.call('GET', '/api/kpi?region=a'); // seq 1，命中 kpi-a
    const draft = hub.ruleFromTraffic(1);
    expect(draft).toMatchObject({
      interfaceId: 'kpi',
      matchers: { query: { region: 'a' } },
      response: { kind: 'static', body: { v: 1 } },
    });
    // 未命中/操作事件不可转换
    hub.call('GET', '/api/nothing');
    expect(hub.ruleFromTraffic(2)).toBeUndefined();
  });
});

describe('真实上游同步（捕获）', () => {
  it('capture 规则未捕获时 #API!；syncUpstream 后返回真实响应并触发刷新回调', async () => {
    const hub = new MockHub(makeProject());
    hub.applyScenario('s2');
    expect(hub.call('GET', '/api/kpi?region=a')).toBe(API_ERROR);
    // 先请求一次，让 hub 记住入参（region=a）
    const fetchMock = vi.fn(async (_url: string) => ({
      ok: true,
      status: 200,
      json: async () => ({ region: 'a', live: true }),
    }) as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);
    let refreshed = 0;
    hub.onDataRefreshed(() => { refreshed += 1; });
    const reports = await hub.syncUpstream();
    expect(reports).toEqual([{ interfaceId: 'kpi', ok: true, detail: expect.any(String) }]);
    // fetch 用的 URL 带上最近一次请求的 query
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/upstream/kpi.json?region=a');
    expect(hub.call('GET', '/api/kpi?region=a')).toEqual({ region: 'a', live: true });
    expect(refreshed).toBe(1);
    // 时间线记录了一条真实捕获流量（同步事件 matchedRuleId 为空；公式命中的 capture 规则不算）
    const captures = hub.timeline.filter((e) => e.kind === 'traffic' && e.source === 'capture' && e.matchedRuleId === null);
    expect(captures).toHaveLength(1);
  });

  it('上游失败：记 miss 流量并保留旧捕获', async () => {
    const hub = new MockHub(makeProject());
    hub.applyScenario('s2');
    hub.call('GET', '/api/kpi?region=a');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 502, json: async () => { throw new Error('bad'); }, text: async () => 'oops' }) as unknown as Response));
    const reports = await hub.syncUpstream();
    expect(reports[0]?.ok).toBe(false);
    const last = hub.timeline.at(-1);
    expect(last && last.kind === 'traffic' ? last.fault : null).toBe('error');
  });
});

describe('编辑器草稿转换', () => {
  it('ruleToDraft ↔ draftToRule 往返：匹配器列表与出参 JSON 保持语义', () => {
    const rule: ApiRule = {
      id: 'r1', interfaceId: 'kpi', name: '北区',
      matchers: { query: { region: 'north' } },
      response: { kind: 'static', body: { v: 1 } },
      fault: 'none', enabled: true, priority: 10,
    };
    const draft = ruleToDraft(rule);
    expect(draft.matchers).toEqual([{ key: 'region', value: 'north' }]);
    expect(draft.bodyText).toBe('{\n  "v": 1\n}');
    const back = draftToRule(draft, 'kpi');
    expect(back.matchers).toEqual({ query: { region: 'north' } });
    expect(back.response).toEqual({ kind: 'static', body: { v: 1 } });
    expect(back.id).toBe('r1'); // 有 id = 编辑而不是新建
  });

  it('draftToRule 对非法 JSON 抛 SyntaxError（表单层捕获展示）', () => {
    const draft = ruleToDraft(undefined);
    expect(() => draftToRule({ ...draft, bodyText: '{oops' }, 'kpi')).toThrow(SyntaxError);
  });
});

describe('持久化', () => {
  it('persist → 变更 → restore 拿到的是保存时的快照', () => {
    const hub = new MockHub(makeProject());
    hub.applyScenario('s2');
    persistProject(hub);
    hub.upsertRule(rule({ id: 'kpi-z', interfaceId: 'kpi', name: 'Z', response: { kind: 'static', body: 7 } }));
    const restored = restoreProject();
    expect(restored?.activeScenarioId).toBe('s2');
    expect(restored?.project.rules.some((r) => r.id === 'kpi-z')).toBe(false);
    expect(restored?.project.scenarios.map((s) => s.id)).toEqual(['s1', 's2']);
    clearPersistedProject();
    expect(restoreProject()).toBeNull();
  });

  it('restore 对损坏存档返回 null，validateProject 拒绝坏结构', () => {
    localStorage.setItem('ssp:project:v1', '{oops');
    expect(restoreProject()).toBeNull();
    localStorage.setItem('ssp:project:v1', JSON.stringify({ version: 1, project: { name: 'x', interfaces: [{ id: 'i' }], rules: [], scenarios: [] }, activeScenarioId: null }));
    expect(restoreProject()).toBeNull(); // 接口缺字段 → 校验失败
    expect(() => validateProject({ name: 'x', interfaces: [], rules: [{ id: 'r', interfaceId: 'ghost', response: {} }], scenarios: [] })).toThrow();
  });

  it('replaceProject 整体替换并切到指定场景', () => {
    const hub = new MockHub(makeProject());
    const fresh = makeProject();
    hub.replaceProject({ ...fresh, scenarios: [fresh.scenarios[1]!] }, 's2');
    expect(hub.project.scenarios).toHaveLength(1);
    expect(hub.activeScenarioId).toBe('s2');
    hub.replaceProject(fresh, '不存在的场景');
    expect(hub.activeScenarioId).toBeNull();
  });
});
