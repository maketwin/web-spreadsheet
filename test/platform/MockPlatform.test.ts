import { describe, expect, it } from 'vitest';
import { FormulaEngine } from '../../src/formula/FormulaEngine';
import { isMatrix } from '../../src/formula/types';
import { Store } from '../../src/store/Store';
import { EventBus } from '../../src/events/EventBus';
import { Command } from '../../src/commands/Command';
import { API_ERROR, MockHub } from '../../src/platform/MockHub';
import { installOperationRecorder } from '../../src/platform/operationRecorder';
import { apiFunctionSpecs } from '../../src/platform/apiFunctions';
import { matchInterface, matchesQuery, parseUrl, pickRule, renderTemplate } from '../../src/platform/RuleEngine';
import type { ApiInterface, MockProject } from '../../src/platform/types';

const ifaces: readonly ApiInterface[] = [
  { id: 'kpi', name: 'KPI', method: 'GET', urlPattern: '/api/kpi', fallback: 'error' },
  { id: 'order', name: '订单', method: 'GET', urlPattern: '/api/orders/{id}', fallback: 'error' },
  { id: 'sales', name: '明细', method: 'GET', urlPattern: '/api/sales', fallback: 'error' },
  { id: 'gone-empty', name: '已下线(空)', method: 'GET', urlPattern: '/api/gone-empty', fallback: 'empty' },
  { id: 'gone-err', name: '已下线(错)', method: 'GET', urlPattern: '/api/gone-err', fallback: 'error' },
];

const makeProject = (): MockProject => ({
  name: '测试项目',
  interfaces: ifaces,
  rules: [
    { id: 'kpi-a', interfaceId: 'kpi', name: 'A区', matchers: { query: { region: 'a' } }, response: { kind: 'static', body: { v: 1 } }, fault: 'none', enabled: true, priority: 10 },
    { id: 'kpi-any', interfaceId: 'kpi', name: '任意', matchers: {}, response: { kind: 'static', body: { v: 0 } }, fault: 'none', enabled: true, priority: 20 },
    { id: 'kpi-500', interfaceId: 'kpi', name: '故障', matchers: {}, response: { kind: 'static', body: null }, fault: 'error', enabled: true, priority: 30 },
    { id: 'order-tpl', interfaceId: 'order', name: '模板', matchers: {}, response: { kind: 'template', body: { id: '{{path.id}}', status: 'ok' } }, fault: 'none', enabled: true, priority: 10 },
    { id: 'sales-2d', interfaceId: 'sales', name: '二维表', matchers: {}, response: { kind: 'static', body: [['产品', 'Q1'], ['A', 1], ['B', 2]] }, fault: 'none', enabled: true, priority: 10 },
  ],
  scenarios: [
    { id: 's1', name: 'S1', description: '', rules: { kpi: 'kpi-a', order: 'order-tpl', sales: 'sales-2d' } },
    { id: 's2', name: 'S2', description: '', rules: { kpi: 'kpi-500', order: 'order-tpl', sales: 'sales-2d' } },
  ],
});

describe('RuleEngine', () => {
  it('parseUrl 拆分路径与 query 并解码', () => {
    const { path, query } = parseUrl('/api/kpi?region=south&tag=%E5%A4%A7%E4%BF%83');
    expect(path).toBe('/api/kpi');
    expect(query).toEqual({ region: 'south', tag: '大促' });
  });

  it('matchInterface 支持精确段与 {param} 捕获，method 必须一致', () => {
    const hit = matchInterface(ifaces, 'GET', '/api/orders/77');
    expect(hit?.iface.id).toBe('order');
    expect(hit?.params).toEqual({ id: '77' });
    expect(matchInterface(ifaces, 'POST', '/api/orders/77')).toBeUndefined();
    expect(matchInterface(ifaces, 'GET', '/api/orders')).toBeUndefined();
  });

  it('matchesQuery 精确匹配、通配 *、缺 key 不匹配', () => {
    expect(matchesQuery({ query: { region: 'a' } }, { region: 'a' })).toBe(true);
    expect(matchesQuery({ query: { region: 'a' } }, { region: 'b' })).toBe(false);
    expect(matchesQuery({ query: { region: '*' } }, {})).toBe(true);
    expect(matchesQuery({ query: { region: 'a' } }, {})).toBe(false);
  });

  it('pickRule：场景钦定优先；钦定规则不匹配入参时按优先级回退', () => {
    const project = makeProject();
    const s1 = project.scenarios[0];
    // s1 钦定 kpi-a，region=a 命中
    expect(pickRule(ifaces[0]!, project.rules, s1, { region: 'a' })?.id).toBe('kpi-a');
    // region=b：钦定的 kpi-a 不匹配 → 回退到任意匹配的 kpi-any
    expect(pickRule(ifaces[0]!, project.rules, s1, { region: 'b' })?.id).toBe('kpi-any');
    // 无场景：纯优先级扫描
    expect(pickRule(ifaces[0]!, project.rules, undefined, { region: 'a' })?.id).toBe('kpi-a');
  });

  it('renderTemplate：整串占位符保留类型，混合串插值，深结构递归', () => {
    const ctx = { query: { region: 'south' }, path: { id: '9' } };
    expect(renderTemplate('{{query.region}}', ctx)).toBe('south');
    expect(renderTemplate('区域 {{query.region}} / 订单 {{path.id}}', ctx)).toBe('区域 south / 订单 9');
    expect(renderTemplate({ a: ['{{path.id}}', 1], b: { c: '{{query.missing}}' } }, ctx))
      .toEqual({ a: ['9', 1], b: { c: '' } });
  });
});

describe('MockHub', () => {
  it('call 返回规则出参并记录流量', () => {
    const hub = new MockHub(makeProject());
    expect(hub.call('GET', '/api/kpi?region=a')).toEqual({ v: 1 });
    expect(hub.call('GET', '/api/kpi?region=b')).toEqual({ v: 0 });
    const traffic = hub.timeline.filter((e) => e.kind === 'traffic');
    expect(traffic).toHaveLength(2);
    expect(hub.ruleHits('kpi-a')).toBe(1);
    expect(hub.ruleHits('kpi-any')).toBe(1);
  });

  it('故障规则与兜底：error 出 #API!，empty 出 null', () => {
    const hub = new MockHub(makeProject());
    hub.applyScenario('s2');
    expect(hub.call('GET', '/api/kpi?region=a')).toBe(API_ERROR);
    expect(hub.call('GET', '/api/gone-empty')).toBeNull();
    expect(hub.call('GET', '/api/gone-err')).toBe(API_ERROR);
    const traffic = hub.timeline.filter((e) => e.kind === 'traffic');
    expect(traffic.filter((e) => e.kind === 'traffic' && e.matchedRuleId === null)).toHaveLength(2);
  });

  it('applyScenario：切换规则、记场景事件、监听器在因果窗口内触发', () => {
    const hub = new MockHub(makeProject());
    let fired = 0;
    hub.onScenarioApplied(() => {
      fired += 1;
      hub.call('GET', '/api/kpi?region=a'); // 宿主全量重算的替身
    });
    hub.applyScenario('s2');
    expect(fired).toBe(1);
    expect(hub.call('GET', '/api/kpi?region=a')).toBe(API_ERROR);
    const scenarioEvent = hub.timeline.find((e) => e.kind === 'scenario');
    expect(scenarioEvent).toMatchObject({ from: 's1', to: 's2' });
    // 场景切换引发的那次调用挂上 causedBy
    const first = hub.timeline.find((e) => e.kind === 'traffic');
    expect(first && first.kind === 'traffic' && first.causedBy).toBe(scenarioEvent?.seq);
    // 重复应用同场景是 no-op
    hub.applyScenario('s2');
    expect(fired).toBe(1);
  });

  it('因果链：操作窗口内的调用挂 causedBy，窗口外为 null', () => {
    const hub = new MockHub(makeProject());
    const opSeq = hub.openCause('cell.edit', 'user');
    hub.call('GET', '/api/kpi?region=a');
    hub.closeCause();
    hub.call('GET', '/api/kpi?region=a');
    const [inWindow, afterWindow] = hub.timeline.filter((e) => e.kind === 'traffic');
    expect(inWindow && inWindow.kind === 'traffic' ? inWindow.causedBy : null).toBe(opSeq);
    expect(afterWindow && afterWindow.kind === 'traffic' ? afterWindow.causedBy : undefined).toBeNull();
  });

  it('clearTimeline 清空记录与命中计数', () => {
    const hub = new MockHub(makeProject());
    hub.call('GET', '/api/kpi?region=a');
    hub.clearTimeline();
    expect(hub.timeline).toHaveLength(0);
    expect(hub.ruleHits('kpi-a')).toBe(0);
  });
});

describe('API 函数桥', () => {
  it('API.GET：标量取字段、缺字段 #N/A、对象无 key 序列化、故障透传', () => {
    const specs = apiFunctionSpecs(new MockHub(makeProject()));
    expect(specs.GET.evaluate(['/api/kpi?region=a', 'v'])).toBe(1);
    expect(specs.GET.evaluate(['/api/kpi?region=a', 'zz'])).toBe('#N/A');
    expect(specs.GET.evaluate(['/api/kpi?region=a'])).toBe('{"v":1}');
    expect(specs.GET.evaluate(['/api/gone-err'])).toBe(API_ERROR);
  });

  it('API.DATA：二维数组转矩阵（可溢出）', () => {
    const specs = apiFunctionSpecs(new MockHub(makeProject()));
    const m = specs.DATA.evaluate(['/api/sales']);
    expect(isMatrix(m)).toBe(true);
    if (isMatrix(m)) {
      expect(m.rows).toBe(3);
      expect(m.cols).toBe(2);
      expect(m.data).toEqual(['产品', 'Q1', 'A', 1, 'B', 2]);
    }
  });

  it('API.DATA：空数组收敛为空串（溢出回收）', () => {
    const hub = new MockHub({
      name: '空数据',
      interfaces: [ifaces[2]!],
      rules: [
        { id: 'sales-empty', interfaceId: 'sales', name: '空', matchers: {}, response: { kind: 'static', body: [] }, fault: 'none', enabled: true, priority: 10 },
      ],
      scenarios: [
        { id: 'only', name: '空场景', description: '', rules: { sales: 'sales-empty' } },
      ],
    });
    expect(apiFunctionSpecs(hub).DATA.evaluate(['/api/sales'])).toBe('');
  });
});

describe('operationRecorder（带值采样）', () => {
  interface EditArgs { readonly r: number; readonly c: number; readonly text: string }
  class FakeEdit extends Command<EditArgs> {
    public execute(store: Store): void {
      store.setCell(this.args.r, this.args.c, { text: this.args.text, value: this.args.text });
    }

    public getUndo(): Command<EditArgs> {
      return this;
    }
  }

  it('单元格编辑：记录 target=B3 与 before → after，撤销方向相反', () => {
    const store = new Store();
    const events = new EventBus();
    const hub = new MockHub(makeProject());
    const off = installOperationRecorder(hub, events, store);
    store.setCell(2, 1, { text: 'north', value: 'north' });

    const cmd = new FakeEdit({ r: 2, c: 1, text: 'south' });
    const run = cmd.execute.bind(cmd);
    events.emit('command:executing', { cmd });
    run(store);
    events.emit('command:executed', { cmd });

    const op = hub.timeline.find((e) => e.kind === 'op');
    expect(op).toMatchObject({ type: 'FakeEdit', via: 'user', target: 'B3', before: 'north', after: 'south' });

    // 撤销：同一命令实例，undoing/undone 配对
    events.emit('command:undoing', { cmd });
    store.setCell(2, 1, { text: 'north', value: 'north' });
    events.emit('command:undone', { cmd });
    const ops = hub.timeline.filter((e) => e.kind === 'op');
    expect(ops.at(-1)).toMatchObject({ via: 'undo', target: 'B3', before: 'south', after: 'north' });
    off();
  });

  it('窗口内的接口调用仍挂 causedBy（采样不影响因果链）', () => {
    const store = new Store();
    const events = new EventBus();
    const hub = new MockHub(makeProject());
    const off = installOperationRecorder(hub, events, store);
    const cmd = new FakeEdit({ r: 2, c: 1, text: 'south' });
    events.emit('command:executing', { cmd });
    hub.call('GET', '/api/kpi?region=a');
    events.emit('command:executed', { cmd });
    const traffic = hub.timeline.find((e) => e.kind === 'traffic');
    const op = hub.timeline.find((e) => e.kind === 'op');
    expect(traffic && traffic.kind === 'traffic' ? traffic.causedBy : null).toBe(op?.seq);
    off();
  });
});

describe('FormulaEngine.recalculateAll', () => {
  it('按依赖拓扑序重算：注册顺序与依赖方向相反也能得到正确终值', () => {
    const store = new Store();
    const engine = new FormulaEngine(store);
    store.setCell(0, 0, { text: '2', value: 2 });
    // 故意先注册下游 C1(=B1+1) 再注册上游 B1(=A1*10)
    engine.setFormula('0,2', '=B1+1', ['0,1']);
    engine.setFormula('0,1', '=A1*10', ['0,0']);
    store.setCell(0, 0, { text: '3', value: 3 });
    engine.recalculateAll();
    expect(store.getCell(0, 1)?.value).toBe(30);
    expect(store.getCell(0, 2)?.value).toBe(31);
  });
});
