import type { Command } from '../commands/Command';
import type { EventBus } from '../events/EventBus';
import type { Store } from '../store/Store';
import type { MockHub } from './MockHub';
import { sampleOp, type OpSample } from './opDetail';
import type { OpVia, ReplayPayload } from './types';

interface Pending {
  readonly seq: number;
  readonly via: OpVia;
  readonly before: OpSample | null;
}

/**
 * 操作记录（变更级）：订阅命令总线的 executing/undoing/redoing 前置事件，
 * 在命令改写 store 之前打开因果窗口——窗口内重算触发的接口调用全部挂上
 * causedBy。
 *
 * 带值采样：执行前/后各采一次目标位置的值（sampleOp），补进操作记录——
 * 时间线由此能回答"改了哪里、从什么值变成什么值"。完成事件按命令实例
 * 配对（executing/executed、undoing/undone、redoing/redone 携带同一 cmd）。
 * store 缺省时退化为只记命令名。
 */
export function installOperationRecorder(hub: MockHub, events: EventBus, store?: Store): () => void {
  const pending = new Map<Command, Pending>();
  // 命令实例 → 它最近一次正向执行（via user/redo）的条目 seq。CommandManager.undo/redo
  // 发的就是栈里那个命令实例，所以撤销时能据此把撤销条目指回它抵消的那条正向条目；
  // 命令在记录器安装之前执行则查不到，撤销条目不写 undoes。
  const forwardSeqs = new WeakMap<Command, number>();

  const open = (via: OpVia) => (payload: unknown): void => {
    const cmd = (payload as { cmd?: Command }).cmd;
    if (cmd === undefined) return;
    const undoes = via === 'undo' ? forwardSeqs.get(cmd) : undefined;
    const seq = hub.openCause(cmd.describe(), via, null, undoes);
    if (store === undefined) {
      hub.closeCause();
      return;
    }
    pending.set(cmd, { seq, via, before: sampleOp(cmd, store) });
  };

  const close = (payload: unknown): void => {
    const cmd = (payload as { cmd?: Command }).cmd;
    if (cmd === undefined) {
      // 非本记录器打开的窗（理论上不会有）：兜底关窗
      hub.closeCause();
      return;
    }
    const entry = pending.get(cmd);
    if (entry === undefined) {
      hub.closeCause();
      return;
    }
    pending.delete(cmd);
    // 正向执行（user/redo）完成即登记：同一命令实例被 redo 后再次撤销，
    // undoes 指向 redo 那条的 seq（redo 也是正向效果的再次发生）。
    if (entry.via !== 'undo') forwardSeqs.set(cmd, entry.seq);
    const after = store === undefined ? null : sampleOp(cmd, store);
    const sample = after ?? entry.before;
    // 撤销条目的载荷必须是所记录操作的逆操作——直接用采样载荷会把"重演撤销"
    // 变成"重演原操作"（改 B3 为 north 再撤销，整段回放却停在 north）。user/redo
    // 照旧直接用采样载荷。
    const replay = entry.via === 'undo'
      ? inverseReplay(sample?.replay ?? null, after?.value ?? null)
      : sample?.replay ?? null;
    hub.amendOp(entry.seq, sample?.target ?? null, entry.before?.value ?? null, after?.value ?? null, replay);
    hub.closeCause();
  };

  const offs = [
    events.on('command:executing', open('user')),
    events.on('command:undoing', open('undo')),
    events.on('command:redoing', open('redo')),
    events.on('command:executed', close),
    events.on('command:undone', close),
    events.on('command:redone', close),
    // A command that threw never reaches its `…ed` event: close on the failure instead.
    events.on('command:failed', close),
  ];
  return () => {
    for (const off of offs) off();
    pending.clear();
  };
}

/**
 * 撤销条目的逆操作载荷：setCell 写回撤销后的值（即被恢复的旧值——cellValue
 * 采的就是公式本体，写回计算值会把公式变成静态文本），位置/sheetId 沿用采样
 * 载荷；insertRow/insertCol 换成对应的 delete；deleteRow/deleteCol 被删的
 * 内容不在载荷里，无法凭空恢复；command 形状的逆需要旧值（参数里没有），记
 * null——撤销条目跳过，由前面的原操作条目承担重放。旧值为空串（空单元格被
 * 写入后撤销）照常写回空串——那同样是这次编辑的逆操作，记成 null 会让回放
 * 停在写入后的值。
 */
function inverseReplay(replay: ReplayPayload | null, restoredValue: string | null): ReplayPayload | null {
  if (replay === null) return null;
  switch (replay.kind) {
    case 'setCell': {
      if (restoredValue === null) return null;
      return { kind: 'setCell', r: replay.r, c: replay.c, text: restoredValue, ...(replay.sheetId !== undefined ? { sheetId: replay.sheetId } : {}) };
    }
    case 'insertRow':
      return { kind: 'deleteRow', r: replay.r, count: replay.count, ...(replay.sheetId !== undefined ? { sheetId: replay.sheetId } : {}) };
    case 'insertCol':
      return { kind: 'deleteCol', c: replay.c, count: replay.count, ...(replay.sheetId !== undefined ? { sheetId: replay.sheetId } : {}) };
    case 'deleteRow':
    case 'deleteCol':
    case 'command':
      return null;
  }
}
