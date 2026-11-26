import { describe, expect, it } from 'vitest';
import { Command } from '../../src/commands/Command';
import { EventBus } from '../../src/events/EventBus';
import { Store } from '../../src/store/Store';
import { MockHub } from '../../src/platform/MockHub';
import { buildDependencyMap } from '../../src/platform/deps';
import { installOperationRecorder } from '../../src/platform/operationRecorder';
import { interfacesFromOpenApi } from '../../src/platform/openapi';
import { replayTimeline } from '../../src/platform/replay';
import type { MockProject } from '../../src/platform/types';

const makeProject = (): MockProject => ({
  name: '收尾',
  interfaces: [
    { id: 'kpi', name: 'KPI', method: 'GET', urlPattern: '/api/kpi', fallback: 'error' },
    { id: 'order', name: '订单', method: 'GET', urlPattern: '/api/orders/{id}', fallback: 'error' },
  ],
  rules: [
    { id: 'kpi-r', interfaceId: 'kpi', name: 'R', matchers: {}, response: { kind: 'static', body: { v: 1 } }, fault: 'none', enabled: true, priority: 10 },
  ],
  scenarios: [{ id: 's1', name: 'S1', description: '', rules: { kpi: 'kpi-r' } }],
});

interface EditArgs { readonly r: number; readonly c: number; readonly text: string }
class FakeEdit extends Command<EditArgs> {
  // 采样按命令身份分派后，匿名命令不再被按形状猜——测试替身声明与 SetCellText
  // 相同的身份（它就是模拟一个单元格编辑）
  public override kind(): 'setCellText' { return 'setCellText'; }

  public execute(store: Store): void {
    store.setCell(this.args.r, this.args.c, { text: this.args.text, value: this.args.text });
  }

  public getUndo(): Command<EditArgs> {
    return this;
  }
}

describe('回放控制（toSeq / 单步游标语义）', () => {
  it('toSeq 截断：只重演到指定 seq', () => {
    const store = new Store();
    const events = new EventBus();
    const hub = new MockHub(makeProject());
    installOperationRecorder(hub, events, store);
    const record = (r: number, c: number, text: string): void => {
      const cmd = new FakeEdit({ r, c, text });
      const run = cmd.execute.bind(cmd);
      events.emit('command:executing', { cmd });
      run(store);
      events.emit('command:executed', { cmd });
    };
    record(0, 0, '第一步');
    const firstSeq = hub.timeline.find((e) => e.kind === 'op')?.seq ?? 0;
    record(1, 0, '第二步');

    store.setCell(0, 0, { text: '被改掉', value: '被改掉' });
    store.setCell(1, 0, { text: '被改掉', value: '被改掉' });
    const report = replayTimeline(hub, store, { toSeq: firstSeq });
    expect(report.replayed).toBe(1);
    expect(store.getCell(0, 0)?.text).toBe('第一步');
    expect(store.getCell(1, 0)?.text).toBe('被改掉');
    // 续放：从 firstSeq+1 到结尾
    replayTimeline(hub, store, { fromSeq: firstSeq + 1 });
    expect(store.getCell(1, 0)?.text).toBe('第二步');
  });
});

describe('OpenAPI 导入', () => {
  const doc = {
    servers: [{ url: 'https://api.example.org/v1' }],
    paths: {
      '/pets': {
        get: { operationId: 'listPets', summary: '宠物列表', parameters: [{ name: 'limit', in: 'query', required: true }] },
        post: { operationId: 'createPet', summary: '创建宠物' },
        put: { operationId: 'replacePets' },
      },
      '/pets/{petId}': {
        get: { operationId: 'showPetById', summary: '查宠物' },
      },
    },
  };

  it('生成接口/上游/capture 规则/存在性断言，跳过不支持方法', () => {
    const { interfaces, rules, skipped } = interfacesFromOpenApi(doc);
    expect(skipped).toEqual(['PUT /pets']);
    expect(interfaces).toHaveLength(3);
    const list = interfaces.find((i) => i.id === 'oa-get-listPets');
    expect(list).toMatchObject({
      name: '宠物列表',
      method: 'GET',
      urlPattern: '/pets',
      upstream: 'https://api.example.org/v1/pets',
      assertions: [{ key: 'limit' }],
    });
    const create = interfaces.find((i) => i.id === 'oa-post-createPet');
    expect(create?.method).toBe('POST');
    // 有上游 → 自动配 capture 规则；无服务器文档 → 占位 static 规则
    expect(rules.filter((r) => r.response.kind === 'capture')).toHaveLength(3);
    const noServer = interfacesFromOpenApi({ paths: { '/x': { get: { operationId: 'x' } } } });
    expect(noServer.rules[0]?.response.kind).toBe('static');
  });

  it('坏文档报可读错误', () => {
    expect(() => interfacesFromOpenApi({})).toThrow('OpenAPI');
    expect(() => interfacesFromOpenApi({ paths: {} })).toThrow('GET/POST');
  });
});

describe('依赖图谱', () => {
  it('扫描公式里的 API.* 调用：字面量与拼接前缀都能定位接口', () => {
    const store = new Store();
    const hub = new MockHub(makeProject());
    // B3=拼接公式（kpi），C7=字面量（order path 参数），D1=普通公式
    store.setCell(2, 1, { text: 'north', value: 'north', formula: '=API.GET("/api/kpi?region="&B2,"revenue")' });
    store.setCell(6, 2, { text: 'ok', value: 'ok', formula: '=API.GET("/api/orders/1001","status")' });
    store.setCell(0, 3, { text: '3', value: 3, formula: '=SUM(A1:A2)' });
    const { byInterface } = buildDependencyMap(store, hub);
    expect(byInterface.get('kpi')).toEqual([{ sheetName: expect.any(String), ref: 'B3' }]);
    expect(byInterface.get('order')).toEqual([{ sheetName: expect.any(String), ref: 'C7' }]);
    expect(byInterface.has('nonexistent' as never as string)).toBe(false);
  });
});
