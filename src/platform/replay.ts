import type { Command } from '../commands/Command';
import { CommandManager } from '../commands/CommandManager';
import { buildReplayableCommand, isReplayableKind } from '../commands/replayRegistry';
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
 * 命令经回放私有的命令管理器以 record:false 程序化执行：与用户编辑同一个
 * store 批处理与异常边界（成千上万个搬表事件合并成一次刷新、一轮重算），
 * 但不污染 undo 栈、不发 command:* 事件，也不重复记操作；重放过程以
 * via='replay' 的操作事件出现在时间线里（带前后值，和真实操作一样可读），
 * 接口调用挂其因果。回放起点快照时间线，自身产生的事件不会被再次回放。
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
  alignScenario(hub, snapshot, fromSeq, toSeq);
  // 回放私有的执行器（不挂 EventBus）：record:false 应用载荷
  const runner = new CommandManager(store);
  const cancelled = collectCancelled(snapshot, fromSeq, toSeq);
  let total = 0;
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
    // 被抵消的条目（撤销条目 + 它指向的正向条目）：正向效果从未发生过，
    // 两条都不回放，各计一次 skipped。
    if (cancelled.has(event.seq)) {
      skipped += 1;
      continue;
    }
    const payload = event.replay;
    if (payload === null) {
      skipped += 1;
      continue;
    }
    // 未知的命令名不抛错、按"跳过"处理——可能来自更新版本导出的时间线（本
    // 版本的白名单里没有它）；后续条目照常回放。
    if (payload.kind === 'command' && !isReplayableKind(payload.command)) {
      skipped += 1;
      continue;
    }
    const before = replaySample(store, payload);
    const seq = hub.openCause(event.type, 'replay', payload);
    try {
      runPayload(payload, runner, event.seq);
      const after = replaySample(store, payload);
      hub.amendOp(seq, replayTarget(payload), before, after, payload);
      const deviation = verify(event, after);
      if (deviation !== null) deviations.push(deviation);
    } finally {
      // 异常路径也要关窗：留着的话，之后的流量会被错挂到这条陈旧因果上
      hub.closeCause();
    }
    replayed += 1;
  }
  return { total, replayed, skipped, deviations };
}

/**
 * 预扫描回放区间，收集要互相抵消的条目 seq（撤销条目 + 它 undoes 指向的正向
 * 条目）。只有"载荷为 null 且带 undoes"的撤销条目参与抵消——带逆载荷的撤销
 * （setCell、插入行列）照常回放逆操作。指向的条目不在区间内（fromSeq 之前）
 * 或已不存在（时间线被清过）：不抵消，撤销条目走"无载荷 → skipped"的老路，
 * 区间外的东西一律不碰。
 *
 * 必须在执行前预扫描：被撤销的正向条目一定排在撤销条目之前（先发生才谈得上
 * 被撤销），若等循环遇到撤销条目才处理，正向效果早已应用，就只能回滚；预扫描
 * 让两条从头就不进执行路径。
 *
 * 正确性依据——撤销是后进先出的：一个命令被撤销时，它之后的命令要么已经被
 * 撤销（各自的撤销条目排在更前面、已各自抵消），要么还在历史里未被触碰；
 * 所以把被撤销的那条从回放中一并跳过，不会影响仍然成立的历史。被抵消的正向
 * 条目如果自己就没有可重放载荷（如 createChart），本来也会 skipped，计数一致。
 */
function collectCancelled(snapshot: readonly TimelineEvent[], fromSeq: number, toSeq: number): ReadonlySet<number> {
  const cancelled = new Set<number>();
  for (const event of snapshot) {
    if (event.seq < fromSeq) continue;
    if (event.seq > toSeq) break;
    if (event.kind !== 'op' || event.via !== 'undo' || event.replay !== null) continue;
    const undoes = event.undoes;
    if (undoes === undefined || undoes < fromSeq || undoes > toSeq) continue;
    const forward = snapshot.find((e) => e.seq === undoes);
    if (forward === undefined || forward.kind !== 'op' || forward.via === 'replay') continue;
    cancelled.add(undoes);
    cancelled.add(event.seq);
  }
  return cancelled;
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

/**
 * 载荷一律经命令管理器程序化执行（record:false，绑定形式调用）：返回 false
 * 只可能是命令体抛了异常（record:false 不查保护）——包装上下文后向上抛，
 * 中止整个回放，而不是悄悄跳过。
 */
function runPayload(payload: ReplayPayload, runner: CommandManager, seq: number): void {
  const run = runner.execute.bind(runner);
  const apply = (cmd: Command): void => {
    if (!run(cmd, { record: false })) throw new Error(`Replay failed at seq ${seq} (${payload.kind})`);
  };
  switch (payload.kind) {
    case 'setCell': {
      apply(new SetCellText({ r: payload.r, c: payload.c, text: payload.text, ...(payload.sheetId !== undefined ? { sheetId: payload.sheetId } : {}) }));
      return;
    }
    case 'insertRow': {
      apply(new InsertRowCommand({ r: payload.r, count: payload.count, ...(payload.sheetId !== undefined ? { sheetId: payload.sheetId } : {}) }));
      return;
    }
    case 'deleteRow': {
      apply(new DeleteRowCommand({ r: payload.r, count: payload.count, ...(payload.sheetId !== undefined ? { sheetId: payload.sheetId } : {}) }));
      return;
    }
    case 'insertCol': {
      apply(new InsertColCommand({ c: payload.c, count: payload.count, ...(payload.sheetId !== undefined ? { sheetId: payload.sheetId } : {}) }));
      return;
    }
    case 'deleteCol': {
      apply(new DeleteColCommand({ c: payload.c, count: payload.count, ...(payload.sheetId !== undefined ? { sheetId: payload.sheetId } : {}) }));
      return;
    }
    case 'command': {
      // 白名单外的名字已在回放循环里计为 skipped，不会走到这里；再判一次只为收窄类型。
      if (!isReplayableKind(payload.command)) return;
      apply(buildReplayableCommand(payload.command, payload.args));
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
