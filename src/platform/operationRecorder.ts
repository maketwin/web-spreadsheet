import type { Command } from '../commands/Command';
import type { EventBus } from '../events/EventBus';
import type { Store } from '../store/Store';
import type { MockHub } from './MockHub';
import { sampleOp, type OpSample } from './opDetail';
import type { OpVia } from './types';

interface Pending {
  readonly seq: number;
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

  const open = (via: OpVia) => (payload: unknown): void => {
    const cmd = (payload as { cmd?: Command }).cmd;
    if (cmd === undefined) return;
    const seq = hub.openCause(cmd.describe(), via);
    if (store === undefined) {
      hub.closeCause();
      return;
    }
    pending.set(cmd, { seq, before: sampleOp(cmd, store) });
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
    const after = store === undefined ? null : sampleOp(cmd, store);
    const sample = after ?? entry.before;
    hub.amendOp(entry.seq, sample?.target ?? null, entry.before?.value ?? null, after?.value ?? null, sample?.replay ?? null);
    hub.closeCause();
  };

  const offs = [
    events.on('command:executing', open('user')),
    events.on('command:undoing', open('undo')),
    events.on('command:redoing', open('redo')),
    events.on('command:executed', close),
    events.on('command:undone', close),
    events.on('command:redone', close),
  ];
  return () => {
    for (const off of offs) off();
    pending.clear();
  };
}
