import { describe, expect, it } from 'vitest';
import type { Command } from '../../src/commands/Command';
import { CommandManager } from '../../src/commands/CommandManager';
import { SetCellText } from '../../src/commands/impl/SetCellText';
import { SetCellStyleCommand } from '../../src/commands/impl/SetCellStyle';
import { SetRangeStyleCommand } from '../../src/commands/impl/SetRangeStyle';
import { SetRowHeight } from '../../src/commands/impl/SetRowHeight';
import { SetMerge } from '../../src/commands/impl/SetMerge';
import { EventBus } from '../../src/events/EventBus';
import { Store } from '../../src/store/Store';
import { applyBundle, buildBundle, importBundleFile } from '../../src/platform/bundle';
import { MockHub } from '../../src/platform/MockHub';
import { installOperationRecorder } from '../../src/platform/operationRecorder';
import { replaySample, replayTarget, sampleOp } from '../../src/platform/opDetail';
import { replayTimeline } from '../../src/platform/replay';
import { validateProject } from '../../src/platform/persistence';
import type { MockProject, TimelineEvent } from '../../src/platform/types';
import type { Style } from '../../src/types';

const makeProject = (): MockProject => ({
  name: '命令回放项目',
  interfaces: [],
  rules: [],
  scenarios: [{ id: 's1', name: 'S1', description: '', rules: {} }],
});

type OpEvent = Extract<TimelineEvent, { kind: 'op' }>;
const recordedOps = (hub: MockHub): OpEvent[] => hub.timeline.filter((e): e is OpEvent => e.kind === 'op' && e.via !== 'replay');

/** 真实链路：命令管理器执行，记录器在旁采样。 */
function setup(): { readonly store: Store; readonly hub: MockHub; readonly manager: CommandManager; readonly run: (cmd: Command) => boolean } {
  const store = new Store();
  const events = new EventBus();
  const hub = new MockHub(makeProject());
  installOperationRecorder(hub, events, store);
  const manager = new CommandManager(store, events);
  return { store, hub, manager, run: manager.execute.bind(manager) };
}

describe('按身份采样的命令载荷', () => {
  // 回归守卫：行高命令曾因类名含 Row 被当成 deleteRow 回放，把行删了。
  it('SetRowHeight 采样的载荷是 setRowHeight，绝不是旧的结构形状（deleteRow/insertRow）', () => {
    const store = new Store();
    const sample = sampleOp(new SetRowHeight({ r: 5, height: 40 }), store);
    expect(sample).toEqual({
      target: '第6行',
      value: null,
      replay: { kind: 'command', command: 'setRowHeight', args: { r: 5, height: 40 } },
    });
    const replay = sample?.replay;
    expect(replay?.kind).toBe('command');
    if (replay !== null && replay !== undefined && replay.kind === 'command') {
      expect(['deleteRow', 'insertRow', 'insertCol', 'deleteCol', 'setCell']).not.toContain(replay.command);
    }
  });

  it('非纯数据的参数（style 里塞函数）：载荷为 null，位置与值采样不受影响', () => {
    const store = new Store();
    store.setCell(1, 1, { text: '脏数据', value: '脏数据' });
    const dirty: Partial<Style> & { weird: () => string } = { bold: true, weird: () => 'x' };
    const sample = sampleOp(new SetCellStyleCommand({ r: 1, c: 1, style: dirty }), store);
    expect(sample?.target).toBe('B2');
    expect(sample?.value).toBe('脏数据');
    expect(sample?.replay).toBeNull();
  });

  it('command 载荷的展示串：单元格/区间/行列各按 kind 给出，未知命令名给 null', () => {
    expect(replayTarget({ kind: 'command', command: 'setCellStyle', args: { r: 2, c: 1 } })).toBe('B3');
    expect(replayTarget({ kind: 'command', command: 'setRangeStyle', args: { r1: 1, c1: 1, r2: 3, c2: 2 } })).toBe('B2:C4');
    expect(replayTarget({ kind: 'command', command: 'setRangeStyle', args: { r1: 1, c1: 1, r2: 1, c2: 1 } })).toBe('B2');
    expect(replayTarget({ kind: 'command', command: 'setColsHidden', args: { c1: 2, c2: 4, hidden: true } })).toBe('第3-5列');
    expect(replayTarget({ kind: 'command', command: 'setRowsHidden', args: { r1: 2, r2: 2, hidden: true } })).toBe('第3行');
    expect(replayTarget({ kind: 'command', command: 'setMerge', args: { range: 'B2:D4', active: true } })).toBe('B2:D4');
    expect(replayTarget({ kind: 'command', command: 'setSheetConditionalRules', args: { entries: [] } })).toBeNull();
    expect(replayTarget({ kind: 'command', command: 'madeUpInAFutureVersion', args: { r: 1, c: 1 } })).toBeNull();
  });

  it('command 载荷的值采样：带 r、c 的单元格命令取当前值，其余 null', () => {
    const store = new Store();
    store.setCell(2, 1, { text: 'v', value: 'v' });
    expect(replaySample(store, { kind: 'command', command: 'setCellStyle', args: { r: 2, c: 1, style: {} } })).toBe('v');
    expect(replaySample(store, { kind: 'command', command: 'setRowHeight', args: { r: 2, height: 9 } })).toBeNull();
    expect(replaySample(store, { kind: 'command', command: 'madeUpCommand', args: { r: 2, c: 1 } })).toBeNull();
    expect(replaySample(store, { kind: 'setCell', r: 2, c: 1, text: '' })).toBe('v');
  });
});

describe('端到端：命令序列回放', () => {
  it('setCellStyle / setRowHeight / setMerge / setRangeStyle 四条回放到另一张起始表，serialize 深度相等', () => {
    const { store, hub, run } = setup();
    store.setCell(1, 1, { text: '数据', value: '数据' });
    store.setCell(3, 4, { text: '角落', value: '角落' });

    run(new SetCellStyleCommand({ r: 1, c: 1, style: { bold: true } }));
    run(new SetRowHeight({ r: 5, height: 40 }));
    run(new SetMerge({ range: 'B2:C3', active: true }));
    run(new SetRangeStyleCommand({ r1: 2, c1: 1, r2: 3, c2: 2, style: { italic: true } }));
    expect(recordedOps(hub)).toHaveLength(4);

    // 同样的起始表
    const target = new Store();
    target.setCell(1, 1, { text: '数据', value: '数据' });
    target.setCell(3, 4, { text: '角落', value: '角落' });

    const report = replayTimeline(hub, target);
    expect(report).toMatchObject({ total: 4, replayed: 4, skipped: 0, deviations: [] });
    expect(target.serialize()).toEqual(store.serialize());
  });

  it('带撤销的序列：setCellText 的 undo 带逆载荷，setCellStyle 的 undo 载荷为 null；回放与真实历史一致', () => {
    const { store, hub, manager, run } = setup();
    store.setCell(2, 1, { text: 'north', value: 'north' });
    run(new SetCellText({ r: 2, c: 1, text: 'south' }));
    manager.undo();
    run(new SetCellStyleCommand({ r: 2, c: 1, style: { bold: true } }));
    manager.undo();

    const ops = recordedOps(hub);
    expect(ops).toHaveLength(4);
    expect(ops[0]?.replay).toEqual({ kind: 'setCell', r: 2, c: 1, text: 'south' });
    expect(ops[1]?.via).toBe('undo');
    expect(ops[1]?.replay).toEqual({ kind: 'setCell', r: 2, c: 1, text: 'north' });
    expect(ops[2]?.replay).toEqual({ kind: 'command', command: 'setCellStyle', args: { r: 2, c: 1, style: { bold: true } } });
    expect(ops[3]?.via).toBe('undo');
    expect(ops[3]?.replay).toBeNull();

    // 整段回放到同样的起始表：不抛错，最终文本与真实历史一致（撤销后的 north）；
    // setCellStyle 正向与它的撤销（无逆载荷）互相抵消，不再残留加粗效果
    const target = new Store();
    target.setCell(2, 1, { text: 'north', value: 'north' });
    const report = replayTimeline(hub, target);
    expect(report).toMatchObject({ total: 4, replayed: 2, skipped: 2, deviations: [] });
    expect(target.getCell(2, 1)?.text).toBe('north');
  });

  it('未知命令名的 command 载荷：计入 skipped、不抛错、继续处理后续条目', () => {
    const store = new Store();
    const hub = new MockHub(makeProject());
    const events: TimelineEvent[] = [
      { seq: 1, ts: Date.now(), kind: 'op', type: 'FutureCommand', via: 'user', target: 'A1', before: null, after: null, replay: { kind: 'command', command: 'futureKind', args: { r: 0, c: 0 } } },
      { seq: 2, ts: Date.now(), kind: 'op', type: 'SetCellText', via: 'user', target: 'B3', before: null, after: 'x', replay: { kind: 'setCell', r: 2, c: 1, text: 'x' } },
    ];
    hub.restoreEvents(events);
    const report = replayTimeline(hub, store);
    expect(report).toMatchObject({ total: 2, replayed: 1, skipped: 1, deviations: [] });
    expect(store.getCell(2, 1)?.text).toBe('x');
  });
});

describe('持久化往返：新形状载荷经复现包不变形', () => {
  it('导出 → JSON → 导入 → 校验 → 应用 → 回放，command 载荷原样存活', async () => {
    const { store, hub, run } = setup();
    store.setCell(0, 0, { text: '锚点', value: '锚点' });
    run(new SetRowHeight({ r: 3, height: 33 }));
    run(new SetCellText({ r: 0, c: 0, text: '改过' }));

    const before = recordedOps(hub).map((op) => op.replay);
    expect(before[0]).toEqual({ kind: 'command', command: 'setRowHeight', args: { r: 3, height: 33 } });

    const bundle = buildBundle(hub, store);
    const file = new File([JSON.stringify(bundle)], 'repro.json', { type: 'application/json' });
    const imported = await importBundleFile(file);
    validateProject(imported.project);

    const importedPayloads = imported.events.filter((e): e is OpEvent => e.kind === 'op').map((op) => op.replay);
    expect(importedPayloads).toEqual(before);

    const store2 = new Store();
    const hub2 = new MockHub(makeProject());
    applyBundle(hub2, store2, imported, () => { /* undo 栈清空 */ });
    expect(store2.getRow(3)?.height).toBe(33);

    const report = replayTimeline(hub2, store2);
    expect(report).toMatchObject({ total: 2, replayed: 2, skipped: 0, deviations: [] });
    expect(store2.getCell(0, 0)?.text).toBe('改过');
  });
});

describe('记录链路：undo/redo 的命令载荷', () => {
  it('redo 的命令载荷仍是原载荷，回放后是改后的样式', () => {
    const { hub, manager, run } = setup();
    run(new SetRowHeight({ r: 2, height: 55 }));
    manager.undo();
    manager.redo();

    const ops = recordedOps(hub);
    expect(ops).toHaveLength(3);
    expect(ops[0]?.replay).toEqual({ kind: 'command', command: 'setRowHeight', args: { r: 2, height: 55 } });
    // undo 条目：command 形状的逆需要旧值，载荷记 null
    expect(ops[1]?.replay).toBeNull();
    // redo 条目：直接用采样载荷，重演原命令
    expect(ops[2]?.replay).toEqual({ kind: 'command', command: 'setRowHeight', args: { r: 2, height: 55 } });

    const target = new Store();
    const report = replayTimeline(hub, target);
    // 正向与它的撤销互相抵消（撤销带 undoes、无逆载荷），只重演 redo 条目
    expect(report).toMatchObject({ total: 3, replayed: 1, skipped: 2 });
    expect(target.getRow(2)?.height).toBe(55);
  });
});
