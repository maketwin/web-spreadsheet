import { describe, expect, it } from 'vitest';
import { CommandManager } from '../../src/commands/CommandManager';
import { DeleteRowCommand } from '../../src/commands/impl/DeleteRow';
import { InsertRowCommand } from '../../src/commands/impl/InsertRow';
import { SetCellText } from '../../src/commands/impl/SetCellText';
import { EventBus } from '../../src/events/EventBus';
import { Store } from '../../src/store/Store';
import { MockHub } from '../../src/platform/MockHub';
import { installOperationRecorder } from '../../src/platform/operationRecorder';
import { replayTimeline } from '../../src/platform/replay';
import type { MockProject, TimelineEvent } from '../../src/platform/types';

const makeProject = (): MockProject => ({
  name: '撤销回放项目',
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
  readonly run: (cmd: SetCellText | InsertRowCommand | DeleteRowCommand) => boolean;
} {
  const store = new Store();
  const events = new EventBus();
  const hub = new MockHub(makeProject());
  installOperationRecorder(hub, events, store);
  const manager = new CommandManager(store, events);
  return { store, hub, manager, run: manager.execute.bind(manager) };
}

describe('撤销条目的回放载荷', () => {
  it('setCell 后撤销：载荷写回修改前的值，整段回放复原、无偏差', () => {
    const { store, hub, manager, run } = setup();
    store.setCell(2, 1, { text: 'north', value: 'north' }); // 修改前的值（不经命令，不入时间线）
    run(new SetCellText({ r: 2, c: 1, text: 'south' }));
    manager.undo();

    const ops = recordedOps(hub);
    expect(ops).toHaveLength(2);
    const undoOp = ops[1]!;
    // 时间线其它字段不变：仍是命令描述 + 撤销前后的值
    expect(undoOp).toMatchObject({ type: 'SetCellText', via: 'undo', target: 'B3', before: 'south', after: 'north' });
    expect(undoOp.replay).toEqual({ kind: 'setCell', r: 2, c: 1, text: 'north' });

    // 从空白工作簿整段回放：两条都重演，B3 回到修改前的值
    const fresh = new Store();
    const report = replayTimeline(hub, fresh);
    expect(report).toMatchObject({ total: 2, replayed: 2, skipped: 0 });
    expect(report.deviations).toEqual([]);
    expect(fresh.getCell(2, 1)?.text).toBe('north');
  });

  it('insertRow 后撤销：载荷换成 deleteRow，回放后布局复原', () => {
    const { store, hub, manager, run } = setup();
    store.setCell(0, 0, { text: 'a', value: 'a' });
    store.setCell(1, 0, { text: 'b', value: 'b' });
    run(new InsertRowCommand({ r: 0, count: 1 }));
    manager.undo();

    const ops = recordedOps(hub);
    expect(ops).toHaveLength(2);
    expect(ops[1]!.replay).toEqual({ kind: 'deleteRow', r: 0, count: 1 });

    const report = replayTimeline(hub, store);
    expect(report).toMatchObject({ total: 2, replayed: 2, skipped: 0 });
    expect(report.deviations).toEqual([]);
    expect(store.getCell(0, 0)?.text).toBe('a');
    expect(store.getCell(1, 0)?.text).toBe('b');
  });

  it('deleteRow 后撤销：被删内容不在载荷里，载荷为 null，回放计入 skipped', () => {
    const { store, hub, manager, run } = setup();
    store.setCell(0, 0, { text: 'a', value: 'a' });
    store.setCell(2, 0, { text: 'c', value: 'c' });
    run(new DeleteRowCommand({ r: 0, count: 1 }));
    manager.undo();

    const ops = recordedOps(hub);
    expect(ops).toHaveLength(2);
    expect(ops[1]!.replay).toBeNull();

    const report = replayTimeline(hub, store);
    // 无逆载荷的撤销（undoes 指向正向条目）与被撤销的正向条目互相抵消：两条都 skipped
    expect(report).toMatchObject({ total: 2, replayed: 0, skipped: 2 });
    expect(report.deviations).toEqual([]);
  });

  it('redo 不受影响：载荷仍是原载荷，三条都回放后是修改后的值', () => {
    const { store, hub, manager, run } = setup();
    store.setCell(2, 1, { text: 'north', value: 'north' });
    run(new SetCellText({ r: 2, c: 1, text: 'south' }));
    manager.undo();
    manager.redo();

    const ops = recordedOps(hub);
    expect(ops).toHaveLength(3);
    expect(ops[1]!.replay).toEqual({ kind: 'setCell', r: 2, c: 1, text: 'north' });
    expect(ops[2]).toMatchObject({ via: 'redo', before: 'north', after: 'south' });
    expect(ops[2]!.replay).toEqual({ kind: 'setCell', r: 2, c: 1, text: 'south' });

    const fresh = new Store();
    const report = replayTimeline(hub, fresh);
    expect(report).toMatchObject({ total: 3, replayed: 3, skipped: 0 });
    expect(report.deviations).toEqual([]);
    expect(fresh.getCell(2, 1)?.text).toBe('south');
  });

  it('公式单元格：撤销载荷是公式本体，不是计算值', () => {
    const { hub, manager, run } = setup();
    run(new SetCellText({ r: 2, c: 1, text: '=A1*2' }));
    run(new SetCellText({ r: 2, c: 1, text: '4' }));
    manager.undo();

    const ops = recordedOps(hub);
    expect(ops).toHaveLength(3);
    expect(ops[2]).toMatchObject({ via: 'undo', before: '4', after: '=A1*2' });
    expect(ops[2]!.replay).toEqual({ kind: 'setCell', r: 2, c: 1, text: '=A1*2' });
  });

  it('修改前为空的单元格：撤销载荷写回空串，回放后单元格仍为空、无偏差', () => {
    const { hub, manager, run } = setup();
    run(new SetCellText({ r: 2, c: 1, text: 'x' }));
    manager.undo();

    const ops = recordedOps(hub);
    expect(ops).toHaveLength(2);
    expect(ops[1]).toMatchObject({ via: 'undo', before: 'x', after: '' });
    // 写回空串才是这次编辑的逆操作；记成 null 会让回放停在 'x'，与真实历史不符。
    expect(ops[1]!.replay).toEqual({ kind: 'setCell', r: 2, c: 1, text: '' });

    const fresh = new Store();
    const report = replayTimeline(hub, fresh);
    expect(report).toMatchObject({ total: 2, replayed: 2, skipped: 0 });
    expect(report.deviations).toEqual([]);
    expect(fresh.getCell(2, 1)?.text ?? '').toBe('');
  });
});
