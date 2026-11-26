import { describe, expect, it } from 'vitest';
import { Command } from '../../src/commands/Command';
import { EventBus } from '../../src/events/EventBus';
import { Store } from '../../src/store/Store';
import { applyBundle, buildBundle, importBundleFile } from '../../src/platform/bundle';
import { MockHub } from '../../src/platform/MockHub';
import { installOperationRecorder } from '../../src/platform/operationRecorder';
import { replayTimeline } from '../../src/platform/replay';
import type { MockProject } from '../../src/platform/types';

const makeProject = (): MockProject => ({
  name: '回放项目',
  interfaces: [{ id: 'kpi', name: 'KPI', method: 'GET', urlPattern: '/api/kpi', fallback: 'error' }],
  rules: [
    { id: 'kpi-a', interfaceId: 'kpi', name: 'A', matchers: {}, response: { kind: 'static', body: { v: 1 } }, fault: 'none', enabled: true, priority: 10 },
  ],
  scenarios: [
    { id: 's1', name: 'S1', description: '', rules: { kpi: 'kpi-a' } },
    { id: 's2', name: 'S2', description: '', rules: { kpi: 'kpi-a' } },
  ],
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

/** 走真实记录器链路录一条可回放的编辑。 */
function recordEdit(events: EventBus, store: Store, r: number, c: number, text: string): void {
  const cmd = new FakeEdit({ r, c, text });
  const run = cmd.execute.bind(cmd);
  events.emit('command:executing', { cmd });
  run(store);
  events.emit('command:executed', { cmd });
}

describe('回放引擎', () => {
  it('重演记录的编辑：值被复原，无偏差，回放操作以 via=replay 入账', () => {
    const store = new Store();
    const events = new EventBus();
    const hub = new MockHub(makeProject());
    installOperationRecorder(hub, events, store);
    recordEdit(events, store, 2, 1, 'south');
    expect(store.getCell(2, 1)?.value).toBe('south');
    // 事后被改成别的值（比如用户手误）
    store.setCell(2, 1, { text: 'oops', value: 'oops' });

    const report = replayTimeline(hub, store);
    expect(report).toMatchObject({ total: 1, replayed: 1, skipped: 0, deviations: [] });
    // 真实 SetCellText 只写 text（value 由展示层派生），验证读 text
    expect(store.getCell(2, 1)?.text).toBe('south');
    const replayOps = hub.timeline.filter((e) => e.kind === 'op' && e.via === 'replay');
    expect(replayOps).toHaveLength(1);
    // 回放条目也带前后值（和真实操作一样可读）
    expect(replayOps[0]).toMatchObject({ target: 'B3', before: 'oops', after: 'south' });
    // 再回放一次：上一轮的 replay 操作不会被重复回放
    const again = replayTimeline(hub, store);
    expect(again.replayed).toBe(1);
  });

  it('与记录值不符时报偏差（复现包里"当时"与"现在"的差异）', () => {
    const store = new Store();
    const hub = new MockHub(makeProject());
    // 手工构造时间线：记录声称 after=X，重放实际写入 Y
    hub.restoreEvents([
      { seq: 1, ts: Date.now(), kind: 'op', type: 'SetCellText', via: 'user', target: 'B3', before: 'north', after: 'X', replay: { kind: 'setCell', r: 2, c: 1, text: 'Y' } },
    ]);
    const report = replayTimeline(hub, store);
    expect(report.deviations).toEqual([{ seq: 1, target: 'B3', expected: 'X', actual: 'Y' }]);
  });

  it('场景切换也被重演；无载荷的操作计入 skipped', () => {
    const store = new Store();
    const hub = new MockHub(makeProject());
    hub.restoreEvents([
      { seq: 1, ts: Date.now(), kind: 'scenario', from: 's1', to: 's2' },
      { seq: 2, ts: Date.now(), kind: 'op', type: 'SetRangeStyle', via: 'user', target: 'B2:D5', before: null, after: null, replay: null },
    ]);
    expect(hub.activeScenarioId).toBe('s1');
    const report = replayTimeline(hub, store);
    expect(hub.activeScenarioId).toBe('s2');
    expect(report).toMatchObject({ total: 2, replayed: 0, skipped: 1 });
  });

  it('回放前对齐起始场景：当前场景与录制时不同则先切回', () => {
    const store = new Store();
    const hub = new MockHub(makeProject());
    // 录制发生在 s2（时间线里没有切换事件——比如被裁剪过）
    hub.restoreEvents([
      {
        seq: 1, ts: Date.now(), kind: 'traffic', interfaceId: 'kpi', url: '/api/kpi?region=a',
        query: { region: 'a' }, matchedRuleId: 'kpi-a', source: 'rule', scenarioId: 's2',
        fault: 'none', delayMs: null, violations: [], response: { v: 1 }, causedBy: null,
      },
      { seq: 2, ts: Date.now(), kind: 'op', type: 'SetCellText', via: 'user', target: 'B3', before: 'north', after: 'south', replay: { kind: 'setCell', r: 2, c: 1, text: 'south' } },
    ]);
    // 当前场景错位到 s1（replaceProject 静默切换，不产生场景事件）
    hub.replaceProject(makeProject(), 's1');
    expect(hub.activeScenarioId).toBe('s1');
    const report = replayTimeline(hub, store);
    // 对齐：先回到录制时的 s2，操作在正确的规则集下重演
    expect(hub.activeScenarioId).toBe('s2');
    expect(store.getCell(2, 1)?.text).toBe('south');
    expect(report.replayed).toBe(1);
  });

  it('undo 载荷保留公式本体（写回计算值会把公式变成静态文本）', () => {
    const store = new Store();
    const events = new EventBus();
    const hub = new MockHub(makeProject());
    installOperationRecorder(hub, events, store);
    // RestoreCell：undo 用的恢复命令，args.cell 带公式
    const cmd = {
      describe: () => 'RestoreCell',
      args: { r: 0, c: 0, cell: { text: '7', value: 7, formula: '=1+6' } },
    };
    events.emit('command:executing', { cmd });
    events.emit('command:executed', { cmd });
    const op = hub.timeline.find((e) => e.kind === 'op');
    expect(op && op.kind === 'op' ? op.replay : null).toMatchObject({ kind: 'setCell', text: '=1+6' });
  });

  it('载荷带 sheetId：重放写到目标工作表而不是活动表', () => {
    const store = new Store();
    const main = store.getActiveSheetId();
    const otherSheet = store.addSheet('数据表'); // addSheet 会把新表设为活动表
    const hub = new MockHub(makeProject());
    hub.restoreEvents([
      { seq: 1, ts: Date.now(), kind: 'op', type: 'SetCellText', via: 'user', target: 'B3', before: '', after: 'x', replay: { kind: 'setCell', r: 2, c: 1, text: 'x', sheetId: main } },
    ]);
    replayTimeline(hub, store);
    expect(store.getCell(2, 1, main)?.text).toBe('x');
    expect(store.getCell(2, 1, otherSheet)?.text ?? '').not.toBe('x');
  });
});

describe('复现包', () => {
  it('导出→导入→应用：工作簿/项目/捕获/事件流完整迁移，seq 接续', async () => {
    const store = new Store();
    store.setCell(0, 0, { text: '快照单元格', value: '快照单元格' });
    const events = new EventBus();
    const hub = new MockHub(makeProject());
    installOperationRecorder(hub, events, store);
    recordEdit(events, store, 2, 1, 'south');

    const bundle = buildBundle(hub, store);
    const file = new File([JSON.stringify(bundle)], 'repro.json', { type: 'application/json' });
    const imported = await importBundleFile(file);

    const store2 = new Store();
    const hub2 = new MockHub({
      name: '别的项目',
      interfaces: [],
      rules: [],
      scenarios: [{ id: 'z', name: 'Z', description: '', rules: {} }],
    });
    applyBundle(hub2, store2, imported);

    expect(store2.getCell(0, 0)?.value).toBe('快照单元格');
    expect(hub2.project.name).toBe('回放项目');
    expect(hub2.timeline.filter((e) => e.kind === 'op')).toHaveLength(1);
    // seq 接续：新事件的 seq 不会与包内事件冲突
    const trafficBefore = hub2.timeline.length;
    hub2.call('GET', '/api/kpi');
    expect(hub2.timeline.length).toBe(trafficBefore + 1);
    const lastSeq = hub2.timeline.at(-1)?.seq;
    expect(lastSeq).toBeGreaterThan(1);
  });

  it('坏包报可读错误：缺工作簿 / 缺事件流 / 版本不符', async () => {
    const bad = (o: Record<string, unknown>): Promise<unknown> =>
      importBundleFile(new File([JSON.stringify(o)], 'bad.json', { type: 'application/json' }));
    const base = {
      version: 1,
      project: { name: 'x', interfaces: [], rules: [], scenarios: [] },
      workbook: { sheets: [{ id: 'a', name: 'S', data: [] }] },
      events: [],
    };
    await expect(bad({ ...base, workbook: {} })).rejects.toThrow('工作簿');
    await expect(bad({ ...base, events: undefined })).rejects.toThrow('事件流');
    await expect(bad({ ...base, version: 99 })).rejects.toThrow('版本');
  });
});
