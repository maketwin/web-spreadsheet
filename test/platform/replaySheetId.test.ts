import { describe, expect, it } from 'vitest';
import { Store } from '../../src/store/Store';
import { MockHub } from '../../src/platform/MockHub';
import { replayTimeline } from '../../src/platform/replay';
import type { MockProject, ReplayPayload, TimelineEvent } from '../../src/platform/types';

const makeProject = (): MockProject => ({
  name: '多表项目',
  interfaces: [],
  rules: [],
  scenarios: [{ id: 's1', name: 'S1', description: '', rules: {} }],
});

const opEvent = (seq: number, replay: ReplayPayload): TimelineEvent => ({
  seq,
  ts: Date.now(),
  kind: 'op',
  type: '命令',
  via: 'user',
  target: 'A1',
  before: null,
  after: 'x',
  replay,
});

/**
 * 核实"回放落到当前活动表"的说法：录制端采载荷时带 sheetId（opDetail.sampleOp），
 * 回放引擎把 sheetId 传给重建的命令（replay.runPayload），命令优先用 args.sheetId
 * （SetCellText/InsertRow/DeleteRow/InsertCol 等）——链路应正确命中录制时的工作表。
 */
describe('回放的 sheetId 处理', () => {
  it('insertRow 载荷带 sheetId：行插进录制时的表，活动表不受影响', () => {
    const store = new Store();
    const main = store.getActiveSheetId();
    store.setCell(0, 0, { text: 'A1', value: 'A1' });
    const other = store.addSheet('别的表'); // addSheet 会把新表设为活动表
    store.setCell(2, 2, { text: '别表C3', value: '别表C3' });

    const hub = new MockHub(makeProject());
    hub.restoreEvents([opEvent(1, { kind: 'insertRow', r: 0, count: 1, sheetId: main })]);
    const report = replayTimeline(hub, store);

    expect(report.replayed).toBe(1);
    // 录制时的表：A1 被整行下移到 A2
    expect(store.getCell(0, 0, main)?.text ?? '').toBe('');
    expect(store.getCell(1, 0, main)?.text).toBe('A1');
    // 当前活动表（别的表）不动
    expect(store.getCell(2, 2, other)?.text).toBe('别表C3');
  });

  it('deleteRow 载荷带 sheetId：删的是录制时的表', () => {
    const store = new Store();
    const main = store.getActiveSheetId();
    store.setCell(0, 0, { text: 'A1', value: 'A1' });
    const other = store.addSheet('别的表');

    const hub = new MockHub(makeProject());
    hub.restoreEvents([opEvent(1, { kind: 'deleteRow', r: 0, count: 1, sheetId: main })]);
    replayTimeline(hub, store);

    expect(store.getCell(0, 0, main)?.text ?? '').toBe('');
    expect(store.getCell(2, 2, other)?.text ?? '').toBe('');
  });

  it('insertCol 载荷带 sheetId：列插进录制时的表', () => {
    const store = new Store();
    const main = store.getActiveSheetId();
    store.setCell(0, 0, { text: 'A1', value: 'A1' });
    const other = store.addSheet('别的表');

    const hub = new MockHub(makeProject());
    hub.restoreEvents([opEvent(1, { kind: 'insertCol', c: 0, count: 1, sheetId: main })]);
    replayTimeline(hub, store);

    expect(store.getCell(0, 1, main)?.text).toBe('A1');
    expect(store.getCell(0, 0, main)?.text ?? '').toBe('');
    // 活动表不受影响
    expect(store.getCell(2, 2, other)?.text ?? '').toBe('');
  });
});
