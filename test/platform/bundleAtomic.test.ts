import { describe, expect, it } from 'vitest';
import { Store } from '../../src/store/Store';
import { applyBundle, buildBundle, importBundleFile, type ReproBundle } from '../../src/platform/bundle';
import { MockHub } from '../../src/platform/MockHub';
import type { MockProject } from '../../src/platform/types';

const makeProject = (): MockProject => ({
  name: '回放项目',
  interfaces: [{ id: 'kpi', name: 'KPI', method: 'GET', urlPattern: '/api/kpi', fallback: 'error' }],
  rules: [
    { id: 'kpi-a', interfaceId: 'kpi', name: 'A', matchers: {}, response: { kind: 'static', body: { v: 1 } }, fault: 'none', enabled: true, priority: 10 },
  ],
  scenarios: [
    { id: 's1', name: 'S1', description: '', rules: { kpi: 'kpi-a' } },
  ],
});

async function bundleFile(hub: MockHub, store: Store): Promise<ReproBundle> {
  const file = new File([JSON.stringify(buildBundle(hub, store))], 'b.repro.json', { type: 'application/json' });
  return importBundleFile(file);
}

/** 目标宿主：跟源 hub/store 都不同（模拟导入到另一份打开的文档）。 */
function makeHost(): { hub: MockHub; store: Store } {
  return {
    hub: new MockHub({ name: '宿主项目', interfaces: [], rules: [], scenarios: [{ id: 'h', name: 'H', description: '', rules: {} }] }),
    store: new Store(),
  };
}

describe('applyBundle 原子性', () => {
  it('项目不合法时在任何状态被改动之前就失败：工作簿、项目、时间线全部原样', async () => {
    const hub = new MockHub(makeProject());
    const store = new Store();
    store.setCell(0, 0, { text: '快照值', value: '快照值' });
    const bundle = await bundleFile(hub, store);

    const host = makeHost();
    host.store.setCell(0, 0, { text: '宿主原值', value: '宿主原值' });
    host.hub.importCaptures({ kpi: { url: '/api/kpi', body: { real: true }, ts: 1 } });
    const timelineBefore = [...host.hub.timeline];

    const broken = { ...bundle, project: { name: 'x', interfaces: [], rules: [{ id: 'r', interfaceId: 'ghost', response: {} }], scenarios: [] } } as unknown as ReproBundle;
    expect(() => applyBundle(host.hub, host.store, broken)).toThrow('不存在的接口');

    expect(host.store.getCell(0, 0)?.text).toBe('宿主原值');
    expect(host.hub.project.name).toBe('宿主项目');
    expect(host.hub.timeline).toEqual(timelineBefore);
    expect(host.hub.captureOf('kpi')?.body).toEqual({ real: true });
  });

  it('应用中途失败（事件流不可迭代）时整体回滚：工作簿与项目都回到应用前', async () => {
    const hub = new MockHub(makeProject());
    const store = new Store();
    store.setCell(0, 0, { text: '快照值', value: '快照值' });
    const bundle = await bundleFile(hub, store);

    const host = makeHost();
    host.store.setCell(3, 2, { text: '宿主原值', value: '宿主原值' });
    host.hub.importCaptures({ kpi: { url: '/api/kpi', body: { before: 1 }, ts: 1 } });
    host.hub.call('GET', '/api/kpi'); // 时间线里留一条流量事件
    const timelineBefore = [...host.hub.timeline];

    // 包本身合法，但 events 坏掉——前几步已改写状态，必须回滚
    const midFail = { ...bundle, events: null } as unknown as ReproBundle;
    expect(() => applyBundle(host.hub, host.store, midFail)).toThrow();

    expect(host.store.getCell(3, 2)?.text).toBe('宿主原值');
    expect(host.store.getCell(0, 0)?.text).toBeUndefined();
    expect(host.hub.project.name).toBe('宿主项目');
    expect(host.hub.activeScenarioId).toBe('h');
    expect([...host.hub.timeline]).toEqual(timelineBefore);
    expect(host.hub.captureOf('kpi')?.body).toEqual({ before: 1 });
  });

  it('回滚后时间线仍可用：原事件恢复，seq 继续接续不冲突', async () => {
    const hub = new MockHub(makeProject());
    const store = new Store();
    const bundle = await bundleFile(hub, store);

    const host = makeHost();
    host.hub.call('GET', '/api/kpi');
    const midFail = { ...bundle, events: null } as unknown as ReproBundle;
    expect(() => applyBundle(host.hub, host.store, midFail)).toThrow();

    // 原时间线被恢复，而不是停在"清空后插入失败"的残缺态
    expect(host.hub.timeline).toHaveLength(1);
    expect(host.hub.timeline[0]).toMatchObject({ kind: 'traffic', seq: 1 });
    host.hub.call('GET', '/api/kpi');
    expect(host.hub.timeline).toHaveLength(2);
    expect(host.hub.timeline[1]?.seq).toBe(2);
  });
});
