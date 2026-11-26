import { afterEach, describe, expect, it, vi } from 'vitest';
import { SetCellText } from '../../src/commands/impl/SetCellText';
import { EventBus } from '../../src/events/EventBus';
import { FormulaEngine } from '../../src/formula/FormulaEngine';
import { createFormulaSync } from '../../src/formula/formulaSync';
import { Store } from '../../src/store/Store';
import { MockHub } from '../../src/platform/MockHub';
import { installOperationRecorder } from '../../src/platform/operationRecorder';
import { replayTimeline } from '../../src/platform/replay';
import type { MockProject, ReplayPayload, TimelineEvent } from '../../src/platform/types';

const makeProject = (): MockProject => ({
  name: '回放批处理项目',
  interfaces: [{ id: 'kpi', name: 'KPI', method: 'GET', urlPattern: '/api/kpi', fallback: 'error' }],
  rules: [
    { id: 'kpi-a', interfaceId: 'kpi', name: 'A', matchers: {}, response: { kind: 'static', body: { v: 1 } }, fault: 'none', enabled: true, priority: 10 },
  ],
  scenarios: [
    { id: 's1', name: 'S1', description: '', rules: { kpi: 'kpi-a' } },
  ],
});

const opEvent = (seq: number, replay: ReplayPayload): TimelineEvent => ({
  seq,
  ts: Date.now(),
  kind: 'op',
  type: '命令',
  via: 'user',
  target: 'A1',
  before: null,
  after: null,
  replay,
});

describe('回放走命令管理器的批处理边界', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('insertRow 载荷：Store 事件全部在批处理刷新内投递，公式链只重算一轮', () => {
    const store = new Store();
    // A 列数字、B 列 =A*2、D1 汇总——插一行会整体搬表，公式同步层挂着
    for (let r = 0; r < 200; r += 1) store.setCell(r, 0, { text: String(r + 1), value: r + 1 });
    for (let r = 0; r < 200; r += 1) store.setCell(r, 1, { text: `=A${r + 1}*2` });
    store.setCell(0, 3, { text: '=SUM(B1:B200)' });

    const engine = new FormulaEngine(store);
    createFormulaSync(store, engine);
    // 先挂同步层（其首轮 reloadFromStore 的写回不投递进 flushing 记录），
    // 再插桩订阅与 drain 计数：reloadFromStore 的首轮重算不计入回放
    const flushing: boolean[] = [];
    store.subscribe(() => { flushing.push(store.isFlushing()); });
    const drainSpy = vi.spyOn(FormulaEngine.prototype as unknown as { drain(): void }, 'drain');

    const hub = new MockHub(makeProject());
    hub.restoreEvents([opEvent(1, { kind: 'insertRow', r: 0, count: 1 })]);
    const report = replayTimeline(hub, store);

    expect(report.replayed).toBe(1);
    expect(flushing.length).toBeGreaterThan(0);
    expect(flushing.every((inFlush) => inFlush)).toBe(true);
    // 修复前：不经批处理，每个事件各自触发一轮重算（上千轮）
    expect(drainSpy).toHaveBeenCalledTimes(1);
  });

  it('回放入账不变：每条载荷一条 via=replay 的 op（type/target/before/after/replay 一样）', () => {
    const store = new Store();
    store.setCell(2, 1, { text: 'north', value: 'north' });
    const hub = new MockHub(makeProject());
    hub.restoreEvents([
      { seq: 1, ts: Date.now(), kind: 'op', type: 'SetCellText', via: 'user', target: 'B3', before: 'north', after: 'south', replay: { kind: 'setCell', r: 2, c: 1, text: 'south' } },
      { seq: 2, ts: Date.now(), kind: 'op', type: 'InsertRowCommand', via: 'user', target: '第1行', before: null, after: null, replay: { kind: 'insertRow', r: 0, count: 1 } },
    ]);

    const report = replayTimeline(hub, store);

    expect(report.replayed).toBe(2);
    expect(report.deviations).toEqual([]);
    const ops = hub.timeline.filter((e) => e.kind === 'op' && e.via === 'replay');
    expect(ops).toHaveLength(2);
    expect(ops[0]).toMatchObject({ type: 'SetCellText', target: 'B3', before: 'north', after: 'south', replay: { kind: 'setCell', r: 2, c: 1, text: 'south' } });
    expect(ops[1]).toMatchObject({ type: 'InsertRowCommand', target: '第1行', before: null, after: null, replay: { kind: 'insertRow', r: 0, count: 1 } });
  });

  it('载荷抛异常：replayTimeline 带上下文抛出，因果窗口已关（后续流量 causedBy 为 null）', () => {
    const store = new Store();
    const hub = new MockHub(makeProject());
    // 不存在的 sheetId 让命令体在 store 访问时抛错（insertRow 的采样不读 store，
    // 异常必然来自命令体而不是执行前的值采样）
    hub.restoreEvents([
      opEvent(1, { kind: 'insertRow', r: 0, count: 1, sheetId: 'no-such-sheet' }),
    ]);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => { /* 命令体异常的预期日志 */ });

    expect(() => replayTimeline(hub, store)).toThrowError('Replay failed at seq 1 (insertRow)');

    errorSpy.mockRestore();
    hub.call('GET', '/api/kpi');
    const traffic = hub.timeline.filter((e) => e.kind === 'traffic').at(-1);
    expect(traffic && traffic.kind === 'traffic' ? traffic.causedBy : null).toBe(null);
  });

  it('回放不碰记录器订阅：退订函数在回放后仍然有效', () => {
    const store = new Store();
    const events = new EventBus();
    const hub = new MockHub(makeProject());
    const off = installOperationRecorder(hub, events, store);
    hub.restoreEvents([opEvent(1, { kind: 'setCell', r: 2, c: 1, text: 'south' })]);

    replayTimeline(hub, store);

    // 回放后记录器仍正常：手动发一对 executing/executed，user op 恰好多一条
    // （时间线里已有 restoreEvents 灌入的一条 via=user 记录）
    const userOps = (): number => hub.timeline.filter((e) => e.kind === 'op' && e.via === 'user').length;
    const beforeManual = userOps();
    const cmd = new SetCellText({ r: 0, c: 0, text: 'manual' });
    events.emit('command:executing', { cmd });
    events.emit('command:executed', { cmd });
    expect(userOps()).toBe(beforeManual + 1);

    // 退订仍可用：退订后同样的手动事件不再入账
    off();
    const second = new SetCellText({ r: 0, c: 1, text: 'manual2' });
    events.emit('command:executing', { cmd: second });
    events.emit('command:executed', { cmd: second });
    expect(userOps()).toBe(beforeManual + 1);
  });
});
