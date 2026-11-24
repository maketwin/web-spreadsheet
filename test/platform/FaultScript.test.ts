import { describe, expect, it } from 'vitest';
import { API_ERROR, MockHub } from '../../src/platform/MockHub';
import { draftToRule, ruleToDraft } from '../../src/platform/editors';
import { runScript, seededFlip } from '../../src/platform/RuleEngine';
import type { ApiInterface, ApiRule, MockProject } from '../../src/platform/types';

const iface = (over: Partial<ApiInterface> & Pick<ApiInterface, 'id'>): ApiInterface => ({
  name: 'I', method: 'GET', urlPattern: `/api/${over.id}`, fallback: 'error', ...over,
});

const rule = (over: Partial<ApiRule> & Pick<ApiRule, 'id' | 'interfaceId' | 'name'>): ApiRule => ({
  matchers: {},
  response: { kind: 'static', body: { v: 1 } },
  fault: 'none',
  enabled: true,
  priority: 10,
  ...over,
});

const makeProject = (ifaces: readonly ApiInterface[], rules: readonly ApiRule[]): MockProject => ({
  name: '故障与脚本',
  interfaces: ifaces,
  rules,
  scenarios: [{ id: 's1', name: 'S1', description: '', rules: Object.fromEntries(ifaces.map((i) => [i.id, rules.find((r) => r.interfaceId === i.id)?.id ?? ''])) }],
});

describe('脚本出参', () => {
  it('按入参动态计算：query 与 path 都可用', () => {
    const hub = new MockHub(makeProject(
      [iface({ id: 'order', urlPattern: '/api/orders/{id}' })],
      [rule({ id: 'r', interfaceId: 'order', name: '脚本', response: { kind: 'script', body: 'return { id: req.path.id, amount: Number(req.path.id) * 3, region: req.query.region };' } })],
    ));
    expect(hub.call('GET', '/api/orders/1001?region=north')).toEqual({ id: '1001', amount: 3003, region: 'north' });
  });

  it('脚本抛错/无返回值：返回 #API!，违规记入流量', () => {
    const hub = new MockHub(makeProject(
      [iface({ id: 'kpi' })],
      [
        rule({ id: 'boom', interfaceId: 'kpi', name: '抛错', matchers: { query: { case: 'boom' } }, response: { kind: 'script', body: 'throw new Error("签名失败")' } }),
        rule({ id: 'noret', interfaceId: 'kpi', name: '无返回', matchers: { query: { case: 'noret' } }, response: { kind: 'script', body: 'req.query' } }),
      ],
    ));
    expect(hub.call('GET', '/api/kpi?case=boom')).toBe(API_ERROR);
    expect(hub.call('GET', '/api/kpi?case=noret')).toBe(API_ERROR);
    const traffic = hub.timeline.filter((e) => e.kind === 'traffic');
    expect(traffic[0]).toMatchObject({ violations: ['脚本错误：签名失败'] });
    expect(traffic[1]).toMatchObject({ violations: [expect.stringContaining('没有返回值')] });
  });

  it('runScript 单元：strict 模式、异常捕获', () => {
    expect(runScript('return 1 + 1;', { query: {}, path: {} })).toEqual({ ok: true, body: 2 });
    expect(runScript('undefinedFn();', { query: {}, path: {} }).ok).toBe(false);
  });
});

describe('故障注入', () => {
  it('超时：返回 #API!，流量标 timeout，与 500 区分', () => {
    const hub = new MockHub(makeProject(
      [iface({ id: 'kpi' })],
      [rule({ id: 'slow', interfaceId: 'kpi', name: '超时', fault: 'timeout' })],
    ));
    expect(hub.call('GET', '/api/kpi?region=a')).toBe(API_ERROR);
    expect(hub.timeline.find((e) => e.kind === 'traffic')).toMatchObject({ fault: 'timeout' });
  });

  it('概率故障可复现：同种子同结果，两个全新 hub 同调用序列结果一致', () => {
    expect(seededFlip('r#1')).toBe(seededFlip('r#1'));
    const build = (): MockHub => new MockHub(makeProject(
      [iface({ id: 'kpi' })],
      [rule({ id: 'flaky', interfaceId: 'kpi', name: '五五开', fault: 'error', faultProbability: 0.5 })],
    ));
    const outcomes = (hub: MockHub): unknown[] => Array.from({ length: 10 }, (_, i) => hub.call('GET', `/api/kpi?region=a&i=${i}`));
    // 序列确定性：同一 hub 重放同一序列由 hitIndex 种子决定；两个全新 hub 完全一致
    expect(outcomes(build())).toEqual(outcomes(build()));
  });

  it('概率=0 不触发、缺省=1 必触发；delayMs 记入流量', () => {
    const hub = new MockHub(makeProject(
      [iface({ id: 'a' }), iface({ id: 'b' })],
      [
        rule({ id: 'never', interfaceId: 'a', name: '零概率', fault: 'error', faultProbability: 0, delayMs: 250 }),
        rule({ id: 'always', interfaceId: 'b', name: '必发', fault: 'error' }),
      ],
    ));
    expect(hub.call('GET', '/api/a')).toEqual({ v: 1 });
    expect(hub.call('GET', '/api/b')).toBe(API_ERROR);
    const [tA, tB] = hub.timeline.filter((e) => e.kind === 'traffic');
    expect(tA).toMatchObject({ fault: 'none', delayMs: 250 });
    expect(tB).toMatchObject({ fault: 'error', delayMs: null });
  });
});

describe('入参断言', () => {
  it('oneOf 违规记红线，不影响出参；合法入参无违规', () => {
    const hub = new MockHub(makeProject(
      [iface({ id: 'kpi', assertions: [{ key: 'region', oneOf: ['north', 'south'] }] })],
      [rule({ id: 'r', interfaceId: 'kpi', name: 'R' })],
    ));
    expect(hub.call('GET', '/api/kpi?region=east')).toEqual({ v: 1 });
    expect(hub.timeline.find((e) => e.kind === 'traffic')?.violations).toEqual(['断言 region=east，期望 ∈ [north | south]']);
    expect(hub.call('GET', '/api/kpi?region=south')).toEqual({ v: 1 });
    expect(hub.timeline.at(-1)).toMatchObject({ violations: [] });
  });

  it('equals 与缺参断言', () => {
    const hub = new MockHub(makeProject(
      [iface({ id: 'x', assertions: [{ key: 'env', equals: 'prod' }, { key: 'token' }] })],
      [rule({ id: 'r', interfaceId: 'x', name: 'R' })],
    ));
    hub.call('GET', '/api/x?env=dev');
    expect(hub.timeline.find((e) => e.kind === 'traffic')?.violations).toEqual([
      '断言 env=dev，期望 prod',
      '断言缺少参数 token',
    ]);
  });
});

describe('编辑器草稿：故障/概率/延迟字段', () => {
  it('round trip：概率与延迟只在非默认时保留', () => {
    const src = rule({ id: 'r1', interfaceId: 'kpi', name: 'X', fault: 'error', faultProbability: 0.3, delayMs: 300 });
    const back = draftToRule(ruleToDraft(src), 'kpi');
    expect(back.fault).toBe('error');
    expect(back.faultProbability).toBe(0.3);
    expect(back.delayMs).toBe(300);
    const plain = draftToRule(ruleToDraft(rule({ id: 'r2', interfaceId: 'kpi', name: 'Y' })), 'kpi');
    expect(plain.faultProbability).toBeUndefined();
    expect(plain.delayMs).toBeUndefined();
  });
});
