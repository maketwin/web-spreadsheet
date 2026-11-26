import { describe, expect, it } from 'vitest';
import { CommandManager } from '../../src/commands/CommandManager';
import { CreateChartCommand } from '../../src/commands/impl/CreateChart';
import { SetCellText } from '../../src/commands/impl/SetCellText';
import { SetRowHeight } from '../../src/commands/impl/SetRowHeight';
import { EventBus } from '../../src/events/EventBus';
import { Store } from '../../src/store/Store';
import { applyBundle, buildBundle, importBundleFile } from '../../src/platform/bundle';
import { MockHub } from '../../src/platform/MockHub';
import { installOperationRecorder } from '../../src/platform/operationRecorder';
import { replayTimeline } from '../../src/platform/replay';
import type { MockProject, TimelineEvent } from '../../src/platform/types';

const makeProject = (): MockProject => ({
  name: '撤销抵消项目',
  interfaces: [],
  rules: [],
  scenarios: [{ id: 's1', name: 'S1', description: '', rules: {} }],
});

type OpEvent = Extract<TimelineEvent, { kind: 'op' }>;

const recordedOps = (hub: MockHub): OpEvent[] => hub.timeline.filter((e): e is OpEvent => e.kind === 'op' && e.via !== 'replay');

/** 真实链路：命令管理器执行/撤销/重做，记录器在旁采样。 */
function setup(): {
  readonly store: Store;
  readonly hub: MockHub;
  readonly manager: CommandManager;
  readonly run: (cmd: SetCellText | SetRowHeight | CreateChartCommand) => boolean;
} {
  const store = new Store();
  const events = new EventBus();
  const hub = new MockHub(makeProject());
  installOperationRecorder(hub, events, store);
  const manager = new CommandManager(store, events);
  return { store, hub, manager, run: manager.execute.bind(manager) };
}

/**
 * 撤销抵消（undoes）：无逆载荷的撤销条目要把它指向的正向条目一起从回放里
 * 抵消掉——否则回放结果会多出真实历史里已经被撤销的效果（旧行为是静默的：
 * 正向回放、撤销 skipped，报告还不报偏差）。
 */
describe('撤销条目的抵消回放', () => {
  it('复现场景：setCellText 与 setRowHeight 各执行后撤销，整段回放与真实历史逐字段一致', () => {
    const { store, hub, manager, run } = setup();
    store.setCell(2, 1, { text: 'south', value: 'south' }); // B3 原值（不经命令，不入时间线）
    run(new SetCellText({ r: 2, c: 1, text: 'north' }));
    manager.undo();
    run(new SetRowHeight({ r: 5, height: 33 }));
    manager.undo();
    // 真实历史结束态：B3=south，第 6 行没有行高
    expect(store.getCell(2, 1)?.text).toBe('south');
    expect(store.getRow(5)?.height).toBeUndefined();

    const ops = recordedOps(hub);
    expect(ops).toHaveLength(4);
    // setCell 撤销带逆载荷且带 undoes；setRowHeight 撤销载荷为 null、靠 undoes 抵消
    expect(ops[0]).toMatchObject({ via: 'user', replay: { kind: 'setCell', r: 2, c: 1, text: 'north' } });
    expect(ops[1]).toMatchObject({ via: 'undo', undoes: ops[0]!.seq, replay: { kind: 'setCell', r: 2, c: 1, text: 'south' } });
    expect(ops[2]).toMatchObject({ via: 'user', replay: { kind: 'command', command: 'setRowHeight', args: { r: 5, height: 33 } } });
    expect(ops[3]).toMatchObject({ via: 'undo', undoes: ops[2]!.seq, replay: null });

    // 整段回放到同样的起始表：setCell 正向 + 逆载荷撤销重演（B3 最终 south），
    // 行高对被抵消（第 6 行不留 33）
    const target = new Store();
    target.setCell(2, 1, { text: 'south', value: 'south' });
    const report = replayTimeline(hub, target);
    expect(report).toMatchObject({ total: 4, replayed: 2, skipped: 2, deviations: [] });
    expect(target.getCell(2, 1)?.text).toBe('south');
    expect(target.getRow(5)?.height).toBeUndefined();
  });

  it('撤销后再重做：redo 条目被回放，行高成立；抵消的只有第一次正向和撤销', () => {
    const { store, hub, manager, run } = setup();
    run(new SetRowHeight({ r: 5, height: 33 }));
    manager.undo();
    manager.redo();
    expect(store.getRow(5)?.height).toBe(33);

    const ops = recordedOps(hub);
    expect(ops).toHaveLength(3);
    expect(ops[1]).toMatchObject({ via: 'undo', undoes: ops[0]!.seq, replay: null });
    expect(ops[2]).toMatchObject({ via: 'redo', replay: { kind: 'command', command: 'setRowHeight', args: { r: 5, height: 33 } } });

    const target = new Store();
    const report = replayTimeline(hub, target);
    expect(report).toMatchObject({ total: 3, replayed: 1, skipped: 2, deviations: [] });
    expect(target.getRow(5)?.height).toBe(33);
  });

  it('redo 后再次撤销：undoes 指向 redo 那条的 seq，回放抵消 redo 与第二次撤销', () => {
    const { hub, manager, run } = setup();
    run(new SetRowHeight({ r: 5, height: 33 }));
    manager.undo();
    manager.redo();
    manager.undo();
    expect(recordedOps(hub)).toHaveLength(4);

    const ops = recordedOps(hub);
    expect(ops[1]).toMatchObject({ via: 'undo', undoes: ops[0]!.seq });
    expect(ops[2]).toMatchObject({ via: 'redo' });
    // 同一命令实例再次撤销：指向 redo 的条目，不是最早的正向条目
    expect(ops[3]).toMatchObject({ via: 'undo', undoes: ops[2]!.seq });

    const target = new Store();
    const report = replayTimeline(hub, target);
    // 正向 + 第一次撤销 抵消；redo + 第二次撤销 抵消——四条全不回放
    expect(report).toMatchObject({ total: 4, replayed: 0, skipped: 4, deviations: [] });
    expect(target.getRow(5)?.height).toBeUndefined();
  });

  it('记录器安装之前执行的正向命令：撤销条目不写 undoes，回放行为与旧时间线一致', () => {
    const store = new Store();
    const events = new EventBus();
    const hub = new MockHub(makeProject());
    const manager = new CommandManager(store, events);
    manager.execute.bind(manager)(new SetRowHeight({ r: 5, height: 33 }));
    // 之后才装记录器：正向条目根本不在时间线里，撤销时无从指向
    installOperationRecorder(hub, events, store);
    manager.undo();

    const ops = recordedOps(hub);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ via: 'undo', replay: null });
    expect(ops[0]!.undoes).toBeUndefined();

    const target = new Store();
    const report = replayTimeline(hub, target);
    expect(report).toMatchObject({ total: 1, replayed: 0, skipped: 1, deviations: [] });
    expect(target.getRow(5)?.height).toBeUndefined();
  });

  it('区间：撤销条目在区间内但其指向的正向条目在 fromSeq 之前——撤销照旧 skipped，不碰区间外', () => {
    const { store, hub, manager, run } = setup();
    run(new SetRowHeight({ r: 5, height: 33 }));
    manager.undo();
    const undoSeq = recordedOps(hub)[1]!.seq;
    run(new SetCellText({ r: 0, c: 0, text: 'x' }));

    // 从撤销条目开始回放：正向条目在区间外，不能为抵消它动任何东西
    const target = new Store();
    const report = replayTimeline(hub, target, { fromSeq: undoSeq });
    expect(report).toMatchObject({ total: 2, replayed: 1, skipped: 1, deviations: [] });
    expect(target.getCell(0, 0)?.text).toBe('x');
    expect(target.getRow(5)?.height).toBeUndefined();
    // store（真实历史）不受回放影响
    expect(store.getRow(5)?.height).toBeUndefined();
  });

  it('区间：fromSeq 从正向条目开始、toSeq 截在撤销条目之前——行高被回放（那段历史里它成立）', () => {
    const { hub, manager, run } = setup();
    run(new SetRowHeight({ r: 5, height: 33 }));
    const forwardSeq = recordedOps(hub)[0]!.seq;
    manager.undo();
    const undoSeq = recordedOps(hub)[1]!.seq;

    const target = new Store();
    const report = replayTimeline(hub, target, { fromSeq: forwardSeq, toSeq: undoSeq - 1 });
    expect(report).toMatchObject({ total: 1, replayed: 1, skipped: 0, deviations: [] });
    expect(target.getRow(5)?.height).toBe(33);
  });

  it('undoes 指向不存在的 seq（时间线清空后撤销）：不抛错，撤销条目 skipped', () => {
    const { store, hub, manager, run } = setup();
    run(new SetRowHeight({ r: 5, height: 33 }));
    hub.clearTimeline();
    manager.undo();
    expect(store.getRow(5)?.height).toBeUndefined();

    const ops = recordedOps(hub);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ via: 'undo', replay: null });

    const target = new Store();
    const report = replayTimeline(hub, target);
    expect(report).toMatchObject({ total: 1, replayed: 0, skipped: 1, deviations: [] });
    expect(target.getRow(5)?.height).toBeUndefined();
  });

  it('没有载荷的命令（createChart）执行后撤销：两条都 skipped，不重复计数，不抛错', () => {
    const { store, hub, manager, run } = setup();
    run(new CreateChartCommand({ r1: 0, c1: 0, r2: 2, c2: 2, type: 'bar' }));
    manager.undo();
    expect(store.getCharts(store.getActiveSheetId())).toHaveLength(0);

    const ops = recordedOps(hub);
    expect(ops).toHaveLength(2);
    expect(ops[0]).toMatchObject({ via: 'user', replay: null });
    expect(ops[1]).toMatchObject({ via: 'undo', undoes: ops[0]!.seq, replay: null });

    const target = new Store();
    const report = replayTimeline(hub, target);
    // 两条各计一次 skipped（total 2 = skipped 2），没有把同一条算两遍
    expect(report).toMatchObject({ total: 2, replayed: 0, skipped: 2, deviations: [] });
    expect(target.getCharts(target.getActiveSheetId())).toHaveLength(0);
  });

  it('带 undoes 的事件经复现包导出 → JSON → 导入 → 回放：字段保留、行为一致', async () => {
    const { store, hub, manager, run } = setup();
    run(new SetRowHeight({ r: 5, height: 33 }));
    manager.undo();

    const bundle = buildBundle(hub, store);
    const file = new File([JSON.stringify(bundle)], 'repro.json', { type: 'application/json' });
    const imported = await importBundleFile(file);

    const importedUndo = imported.events.find((e): e is OpEvent => e.kind === 'op' && e.via === 'undo');
    expect(importedUndo).toBeDefined();
    expect(importedUndo!.undoes).toBe(1);

    const store2 = new Store();
    const hub2 = new MockHub(makeProject());
    applyBundle(hub2, store2, imported, () => { /* undo 栈清空 */ });
    const report = replayTimeline(hub2, store2);
    expect(report).toMatchObject({ total: 2, replayed: 0, skipped: 2, deviations: [] });
    expect(store2.getRow(5)?.height).toBeUndefined();
  });

  it('旧形状（没有 undoes 字段）的事件流：回放行为与从前一致——正向回放、撤销 skipped', () => {
    const hub = new MockHub(makeProject());
    const events: TimelineEvent[] = [
      { seq: 1, ts: Date.now(), kind: 'op', type: 'SetRowHeight', via: 'user', target: '第6行', before: null, after: null, replay: { kind: 'command', command: 'setRowHeight', args: { r: 5, height: 33 } } },
      { seq: 2, ts: Date.now(), kind: 'op', type: 'SetRowHeight', via: 'undo', target: '第6行', before: null, after: null, replay: null },
    ];
    hub.restoreEvents(events);

    const target = new Store();
    const report = replayTimeline(hub, target);
    expect(report).toMatchObject({ total: 2, replayed: 1, skipped: 1, deviations: [] });
    expect(target.getRow(5)?.height).toBe(33);
  });
});
