import { DeleteColCommand } from '../commands/impl/DeleteCol';
import { DeleteRowCommand } from '../commands/impl/DeleteRow';
import { InsertColCommand } from '../commands/impl/InsertCol';
import { InsertRowCommand } from '../commands/impl/InsertRow';
import { SetCellText } from '../commands/impl/SetCellText';
import type { Store } from '../store/Store';
import type { MockHub } from './MockHub';
import { replaySample, replayTarget } from './opDetail';
import type { ReplayPayload, TimelineEvent } from './types';

/** 单条重放偏差：重放后的实际值 ≠ 记录的 after。 */
export interface ReplayDeviation {
  readonly seq: number;
  readonly target: string | null;
  readonly expected: string | null;
  readonly actual: string | null;
}

export interface ReplayReport {
  /** 时间线里的可回放事件总数（操作 + 场景切换）。 */
  readonly total: number;
  /** 实际重放的操作数。 */
  readonly replayed: number;
  /** 无可重放载荷、跳过的操作数。 */
  readonly skipped: number;
  readonly deviations: readonly ReplayDeviation[];
}

/**
 * 回放引擎：按 seq 顺序重演时间线里的场景切换与可重放操作，接口调用全部
 * 走当前 mock 规则（确定性），每步与记录的 after 比对——复现"当时发生了
 * 什么"，偏差暴露"现在与当时有什么不同"。
 *
 * 命令直接对 store 执行（不经命令总线）：不污染 undo 栈，也不重复记操作；
 * 重放过程以 via='replay' 的操作事件出现在时间线里（带前后值，和真实操作
 * 一样可读），接口调用挂其因果。回放起点快照时间线，自身产生的事件不会
 * 被再次回放。
 *
 * 回放前先把场景对齐到"当时"——否则第一个操作就在错误的规则集下重算，
 * 公式结果必然偏差。起始场景取回放区间前最近一次场景切换的目标；区间内
 * 没有切换则取第一条流量的 scenarioId。
 *
 * @param opts.fromSeq 起始事件 seq（含）；缺省从头。
 * @param opts.toSeq   终止事件 seq（含）——步进/回放到某步的控制条用。
 */
export function replayTimeline(hub: MockHub, store: Store, opts?: { readonly fromSeq?: number; readonly toSeq?: number }): ReplayReport {
  const snapshot = [...hub.timeline];
  const fromSeq = opts?.fromSeq ?? 0;
  const toSeq = opts?.toSeq ?? Number.POSITIVE_INFINITY;
  alignScenario(hub, snapshot, fromSeq, toSeq);  let total = 0;
  let replayed = 0;
  let skipped = 0;
  const deviations: ReplayDeviation[] = [];

  for (const event of snapshot) {
    if (event.seq < fromSeq) continue;
    if (event.seq > toSeq) break;
    if (event.kind === 'scenario') {
      total += 1;
      hub.applyScenario(event.to);
      continue;
    }
    if (event.kind !== 'op' || event.via === 'replay') continue;
    total += 1;
    const payload = event.replay;
    if (payload === null) {
      skipped += 1;
      continue;
    }
    const before = replaySample(store, payload);
    const seq = hub.openCause(event.type, 'replay', payload);
    runPayload(payload, store);
    const after = replaySample(store, payload);
    hub.amendOp(seq, replayTarget(payload), before, after, payload);
    const deviation = verify(event, after);
    if (deviation !== null) deviations.push(deviation);
    hub.closeCause();
    replayed += 1;
  }
  return { total, replayed, skipped, deviations };
}

/** 把场景对齐到回放起点"当时"的场景（不同则切换并记录一次场景事件）。 */
function alignScenario(hub: MockHub, snapshot: readonly TimelineEvent[], fromSeq: number, toSeq: number): void {
  const target = scenarioAtStart(snapshot, fromSeq, toSeq);
  if (target !== null && target !== hub.activeScenarioId) hub.applyScenario(target);
}

function scenarioAtStart(snapshot: readonly TimelineEvent[], fromSeq: number, toSeq: number): string | null {
  // 区间前最近一次切换的目标 = 区间起点时的场景
  for (let i = snapshot.length - 1; i >= 0; i -= 1) {
    const e = snapshot[i];
    if (e !== undefined && e.kind === 'scenario' && e.seq < fromSeq) return e.to;
  }
  // 区间内首场切换的 from；再退到第一条流量的 scenarioId
  const firstIn = snapshot.find((e) => e.kind === 'scenario' && e.seq >= fromSeq && e.seq <= toSeq);
  if (firstIn !== undefined && firstIn.kind === 'scenario') return firstIn.from;
  const traffic = snapshot.find((e) => e.kind === 'traffic');
  return traffic !== undefined && traffic.kind === 'traffic' ? traffic.scenarioId : null;
}

function runPayload(payload: ReplayPayload, store: Store): void {
  switch (payload.kind) {
    case 'setCell': {
      const cmd = new SetCellText({ r: payload.r, c: payload.c, text: payload.text, ...(payload.sheetId !== undefined ? { sheetId: payload.sheetId } : {}) });
      const run = cmd.execute.bind(cmd);
      run(store);
      return;
    }
    case 'insertRow': {
      const cmd = new InsertRowCommand({ r: payload.r, count: payload.count, ...(payload.sheetId !== undefined ? { sheetId: payload.sheetId } : {}) });
      const run = cmd.execute.bind(cmd);
      run(store);
      return;
    }
    case 'deleteRow': {
      const cmd = new DeleteRowCommand({ r: payload.r, count: payload.count, ...(payload.sheetId !== undefined ? { sheetId: payload.sheetId } : {}) });
      const run = cmd.execute.bind(cmd);
      run(store);
      return;
    }
    case 'insertCol': {
      const cmd = new InsertColCommand({ c: payload.c, count: payload.count, ...(payload.sheetId !== undefined ? { sheetId: payload.sheetId } : {}) });
      const run = cmd.execute.bind(cmd);
      run(store);
      return;
    }
    case 'deleteCol': {
      const cmd = new DeleteColCommand({ c: payload.c, count: payload.count, ...(payload.sheetId !== undefined ? { sheetId: payload.sheetId } : {}) });
      const run = cmd.execute.bind(cmd);
      run(store);
      return;
    }
  }
}

/** 与记录的 after 比对（仅 setCell 类有值可比）：公式单元格比公式本体。 */
function verify(event: Extract<TimelineEvent, { kind: 'op' }>, actual: string | null): ReplayDeviation | null {
  if (event.replay === null || event.replay.kind !== 'setCell') return null;
  if (actual === (event.after ?? '')) return null;
  return { seq: event.seq, target: event.target, expected: event.after, actual };
}
