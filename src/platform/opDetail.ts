import type { Command } from '../commands/Command';
import type { Store } from '../store/Store';
import { num2alpha } from '../util/alphabet';
import type { ReplayPayload } from './types';

/**
 * 操作摘要提取：从命令的 args 里读出"动了哪里"（target）、"当时是什么值"
 * （value）和"可重放载荷"（replay）。值在执行前/后各采样一次，拼成
 * before → after；replay 供回放引擎重建命令。未识别的命令全为 null，
 * 时间线退化为只显示命令名。
 */

export interface OpSample {
  readonly target: string;
  readonly value: string | null;
  readonly replay: ReplayPayload | null;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function argsOf(cmd: Command): Record<string, unknown> | null {
  const args = (cmd as unknown as { args?: unknown }).args;
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return null;
  return args as Record<string, unknown>;
}

function cellRef(r: number, c: number): string {
  return `${num2alpha(c)}${r + 1}`;
}

/** 单元格当前显示值：公式单元格显示公式，空单元格显示空串。 */
function cellValue(store: Store, r: number, c: number, sheetId: string | undefined): string | null {
  const cell = store.getCell(r, c, sheetId);
  if (cell === undefined) return '';
  return cell.formula ?? cell.text ?? '';
}

/** 重放载荷对应的展示目标（与采样时的 target 格式一致）。 */
export function replayTarget(payload: ReplayPayload): string {
  switch (payload.kind) {
    case 'setCell':
      return cellRef(payload.r, payload.c);
    case 'insertRow':
    case 'deleteRow':
      return payload.count > 1 ? `第${payload.r + 1}-${payload.r + payload.count}行` : `第${payload.r + 1}行`;
    case 'insertCol':
    case 'deleteCol':
      return payload.count > 1 ? `第${payload.c + 1}-${payload.c + payload.count}列` : `第${payload.c + 1}列`;
  }
}

/** 重放前后的单元格采样（回放条目的值显示用）。 */
export function replaySample(store: Store, payload: ReplayPayload): string | null {
  if (payload.kind !== 'setCell') return null;
  return cellValue(store, payload.r, payload.c, payload.sheetId);
}

function rangeRef(r1: number, c1: number, r2: number, c2: number): string {
  return r1 === r2 && c1 === c2 ? cellRef(r1, c1) : `${cellRef(r1, c1)}:${cellRef(r2, c2)}`;
}

export function sampleOp(cmd: Command, store: Store): OpSample | null {
  const name = cmd.describe();
  const args = argsOf(cmd);
  if (args === null) return null;
  const sheetId = typeof args.sheetId === 'string' ? args.sheetId : undefined;
  const r = num(args.r);
  const c = num(args.c);
  const r1 = num(args.r1);
  const c1 = num(args.c1);
  const count = num(args.count) ?? 1;

  // 行/列结构操作：只有位置，载荷按命令名分派
  if (r !== null && /row/i.test(name)) {
    const kind = /insert/i.test(name) ? 'insertRow' : 'deleteRow';
    return {
      target: count > 1 ? `第${r + 1}-${r + count}行` : `第${r + 1}行`,
      value: null,
      replay: { kind, r, count, ...(sheetId !== undefined ? { sheetId } : {}) },
    };
  }
  if (c !== null && /col/i.test(name)) {
    const kind = /insert/i.test(name) ? 'insertCol' : 'deleteCol';
    return {
      target: count > 1 ? `第${c + 1}-${c + count}列` : `第${c + 1}列`,
      value: null,
      replay: { kind, c, count, ...(sheetId !== undefined ? { sheetId } : {}) },
    };
  }
  // 区间命令（样式/边框/填充等）：显示范围，不可重放
  if (r1 !== null && c1 !== null) {
    return { target: rangeRef(r1, c1, num(args.r2) ?? r1, num(args.c2) ?? c1), value: null, replay: null };
  }
  // 单元格命令（编辑/恢复/样式）：位置 + 当前值；编辑类可重放
  if (r !== null && c !== null) {
    let replay: ReplayPayload | null = null;
    if (typeof args.text === 'string') {
      replay = { kind: 'setCell', r, c, text: args.text, ...(sheetId !== undefined ? { sheetId } : {}) };
    } else if ('cell' in args) {
      // 恢复类命令（undo 用的 RestoreCell）：重放为写回旧值——公式单元格必须
      // 写回公式本体（写计算值会把公式变成静态文本）
      const oldCell = args.cell;
      const text = typeof oldCell === 'object' && oldCell !== null
        ? ((oldCell as { formula?: unknown }).formula ?? (oldCell as { text?: unknown }).text ?? '')
        : '';
      replay = {
        kind: 'setCell',
        r,
        c,
        text: typeof text === 'string' ? text : '',
        ...(sheetId !== undefined ? { sheetId } : {}),
      };
    }
    return { target: cellRef(r, c), value: cellValue(store, r, c, sheetId), replay };
  }
  return null;
}
