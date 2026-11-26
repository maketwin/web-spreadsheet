import type { Command, StructuralKind } from '../commands/Command';
import type { Store } from '../store/Store';
import { num2alpha } from '../util/alphabet';
import type { ReplayPayload } from './types';

/**
 * 操作摘要提取：从命令的稳定身份（cmd.kind()）分派，读出"动了哪里"
 * （target）、"当时是什么值"（value）和"可重放载荷"（replay）。值在执行前/后
 * 各采样一次，拼成 before → after；replay 供回放引擎重建命令。
 *
 * 分派规则：
 * - 四个结构命令（structuralKind）与 setCellText：继续产出旧的 5 种载荷形状
 *   （kind='setCell'/'insertRow'/…）——已持久化的时间线、复现包和面板显示代码
 *   都依赖它们，不改。
 * - 其它白名单命令（REPLAYABLE_KINDS）：产出新形状 {kind:'command', command, args}，
 *   前提是参数是纯数据（isPlainData）；不是纯数据则 replay 为 null。
 * - 其余有身份的命令（图表/图片/整块数据等，不在白名单）：只展示位置，不可重放。
 * - 没有身份的命令（kind 为 null）：除"恢复类"旧路径外全为 null，时间线退化为
 *   只显示命令名。
 *
 * 位置展示串仍按参数形状计算，但那只影响文案，不再决定命令身份或可重放性
 * ——历史上按形状猜身份曾把行高命令当成删行回放（类名含 Row），故作废。
 */

export interface OpSample {
  readonly target: string | null;
  readonly value: string | null;
  readonly replay: ReplayPayload | null;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * 平台侧可重放命令名投影：与 src/commands/replayRegistry.ts 的 BUILDERS 白名单
 * 保持一致（那边是唯一权威）。分层规则不允许平台核心值导入 src/commands/**，
 * 这里只能按 kind 字符串分派——commandKind.test.ts 有同步守卫，两边漂移会变红。
 * 五个旧形状种类（setCellText 与四个结构命令）走旧载荷路径，不在此表分派。
 * 导出仅供同步守卫测试比对。
 */
export const COMMAND_PAYLOAD_KINDS: ReadonlySet<string> = new Set([
  'setCellStyle',
  'setRangeStyle',
  'setRangeBorder',
  'setNumberFormat',
  'setRowHeight',
  'setColWidth',
  'setRowsHidden',
  'setColsHidden',
  'setMerge',
  'setMergeAcross',
  'applyMergeChanges',
  'setValidation',
  'setConditionalFormat',
  'setSheetConditionalRules',
  'setHyperlink',
  'setCellComment',
  'moveRange',
  'fillRange',
  'sortRange',
  'removeDuplicates',
  'textToColumns',
  'setAutoFilter',
  'setAutoFilterCriteria',
  'applyTableStyle',
  'setAxisStyle',
  'clearAxisStyle',
]);

/** 值采样只对这些带 r、c 的单元格命令做（编辑类 setCellText 走旧路径自带采样）。 */
const CELL_VALUE_KINDS: ReadonlySet<string> = new Set(['setCellStyle', 'setHyperlink', 'setCellComment']);

/**
 * 纯数据判定：只含 null/undefined/boolean/number/string、数组、原型为
 * Object.prototype 或 null 的对象。出现函数、类实例、Symbol、BigInt 即否——
 * 这样的载荷无法经 JSON 持久化/往返，不能进时间线。
 */
export function isPlainData(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  switch (typeof v) {
    case 'boolean':
    case 'number':
    case 'string':
      return true;
    case 'object':
      break;
    default:
      // function / symbol / bigint
      return false;
  }
  if (Array.isArray(v)) return v.every(isPlainData);
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) return false;
  return Object.values(v).every(isPlainData);
}

/** 纯数据的深拷贝（载荷入时间线后还会经 JSON 持久化，拷贝避免引用共享）。 */
function cloneData(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(cloneData);
  if (typeof v === 'object' && v !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(v)) out[key] = cloneData(value);
    return out;
  }
  return v;
}

function argsOf(cmd: Command): Record<string, unknown> | null {
  const args = cmd.args;
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return null;
  return args as Record<string, unknown>;
}

function kindOf(cmd: Command): string | null {
  const declared = (cmd as { kind?: () => string | null }).kind;
  return typeof declared === 'function' ? declared.call(cmd) : null;
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

function rangeRef(r1: number, c1: number, r2: number, c2: number): string {
  return r1 === r2 && c1 === c2 ? cellRef(r1, c1) : `${cellRef(r1, c1)}:${cellRef(r2, c2)}`;
}

function spanRef(first: number, last: number, unit: '行' | '列'): string {
  return last > first ? `第${first + 1}-${last + 1}${unit}` : `第${first + 1}${unit}`;
}

interface Box { readonly r1: number; readonly c1: number; readonly r2: number; readonly c2: number }

function boxNums(box: unknown): Box | null {
  if (typeof box !== 'object' || box === null) return null;
  const r1 = num((box as Box).r1);
  const c1 = num((box as Box).c1);
  if (r1 === null || c1 === null) return null;
  return { r1, c1, r2: num((box as Box).r2) ?? r1, c2: num((box as Box).c2) ?? c1 };
}

function mergeStrings(values: unknown): readonly string[] {
  return Array.isArray(values) ? values.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * 按稳定身份给出展示串（只影响文案）：单元格命令 → B3；区间命令 → B2:D4（单格
 * 只给单格）；行/列命令 → 第N行/第N列（区间同理）；合并 → 区间串；其余 → null。
 */
function kindTarget(kind: string, args: Record<string, unknown>): string | null {
  const r = num(args.r);
  const c = num(args.c);
  const box = boxNums(args);
  switch (kind) {
    case 'setCellStyle':
    case 'setHyperlink':
    case 'setCellComment':
    case 'setCellText':
      return r !== null && c !== null ? cellRef(r, c) : null;
    case 'setRowHeight':
      return r !== null ? `第${r + 1}行` : null;
    case 'setColWidth':
      return c !== null ? `第${c + 1}列` : null;
    case 'setRowsHidden': {
      const r1 = num(args.r1);
      const r2 = num(args.r2);
      return r1 !== null && r2 !== null ? spanRef(r1, r2, '行') : null;
    }
    case 'setColsHidden': {
      const c1 = num(args.c1);
      const c2 = num(args.c2);
      return c1 !== null && c2 !== null ? spanRef(c1, c2, '列') : null;
    }
    case 'setAxisStyle':
    case 'clearAxisStyle': {
      // Whole-column / whole-row format writes: the span is on the axis the args name.
      const from = num(args.from);
      const to = num(args.to);
      if (from === null || to === null) return null;
      return args.axis === 'col' ? spanRef(from, to, '列') : spanRef(from, to, '行');
    }
    case 'setAutoFilterCriteria': {
      const column = num(args.column);
      return column !== null ? `第${column + 1}列` : null;
    }
    case 'setMerge':
    case 'setMergeAcross': {
      const range = args.range;
      return typeof range === 'string' && range !== '' ? range : null;
    }
    case 'applyMergeChanges': {
      const all = [...mergeStrings(args.add), ...mergeStrings(args.remove)];
      return all.length > 0 ? all.join('、') : null;
    }
    case 'moveRange':
    case 'fillRange': {
      const source = boxNums(args.source);
      const target = boxNums(args.target);
      if (source === null || target === null) return null;
      return `${rangeRef(source.r1, source.c1, source.r2, source.c2)}→${rangeRef(target.r1, target.c1, target.r2, target.c2)}`;
    }
    default:
      // 区间命令与兜底：有 r1/c1 显示区间，有 r/c 显示单元格
      if (box !== null) return rangeRef(box.r1, box.c1, box.r2, box.c2);
      if (r !== null && c !== null) return cellRef(r, c);
      return null;
  }
}

/** 命令声明的结构种类（见 Command.structuralKind）。平台核心不导入命令实现类，按声明读取。 */
function structuralKindOf(cmd: Command): StructuralKind | null {
  const declared = (cmd as { structuralKind?: () => StructuralKind | null }).structuralKind;
  return typeof declared === 'function' ? declared.call(cmd) : null;
}

function sampleStructural(structural: StructuralKind, args: Record<string, unknown>, sheetId: string | undefined): OpSample | null {
  const r = num(args.r);
  const c = num(args.c);
  const count = num(args.count) ?? 1;
  const sheet = sheetId !== undefined ? { sheetId } : {};
  if (structural === 'insertRow' || structural === 'deleteRow') {
    if (r === null) return null;
    return {
      target: count > 1 ? `第${r + 1}-${r + count}行` : `第${r + 1}行`,
      value: null,
      replay: { kind: structural, r, count, ...sheet },
    };
  }
  if (c === null) return null;
  return {
    target: count > 1 ? `第${c + 1}-${c + count}列` : `第${c + 1}列`,
    value: null,
    replay: { kind: structural, c, count, ...sheet },
  };
}

export function sampleOp(cmd: Command, store: Store): OpSample | null {
  const args = argsOf(cmd);
  if (args === null) return null;
  const sheetId = typeof args.sheetId === 'string' ? args.sheetId : undefined;
  const kind = kindOf(cmd);

  // 行/列结构操作：只有位置，载荷按命令自己声明的种类分派。不能按类名猜——
  // 行高/列宽命令的类名同样含 Row/Col，且类名在压缩构建后会被改掉；曾因此把
  // SetRowHeight 记成 deleteRow，重放时直接把行删掉。
  const structural = structuralKindOf(cmd);
  if (structural !== null) return sampleStructural(structural, args, sheetId);

  const r = num(args.r);
  const c = num(args.c);

  // setCellText：继续产出旧的 setCell 载荷（richText 不入载荷，重放为纯文本——与既有数据一致）
  if (kind === 'setCellText') {
    if (r === null || c === null) return null;
    const text = args.text;
    const sheet = sheetId !== undefined ? { sheetId } : {};
    return {
      target: cellRef(r, c),
      value: cellValue(store, r, c, sheetId),
      replay: typeof text === 'string' ? { kind: 'setCell', r, c, text, ...sheet } : null,
    };
  }

  // 恢复类命令（undo 用的 RestoreCell，经手动事件进入记录器）：重放为写回旧值——
  // 公式单元格必须写回公式本体（写计算值会把公式变成静态文本）。这类命令没有
  // 稳定身份（kind 为 null），按 args 里的 cell 键识别；有身份的命令不走这里。
  if (kind === null && 'cell' in args) {
    if (r === null || c === null) return null;
    const oldCell = args.cell;
    const text = typeof oldCell === 'object' && oldCell !== null
      ? ((oldCell as { formula?: unknown }).formula ?? (oldCell as { text?: unknown }).text ?? '')
      : '';
    const sheet = sheetId !== undefined ? { sheetId } : {};
    return {
      target: cellRef(r, c),
      value: cellValue(store, r, c, sheetId),
      replay: { kind: 'setCell', r, c, text: typeof text === 'string' ? text : '', ...sheet },
    };
  }

  // 白名单命令：按稳定身份产出新载荷（纯数据才可持久化/重放）
  if (kind !== null && COMMAND_PAYLOAD_KINDS.has(kind)) {
    return {
      target: kindTarget(kind, args),
      value: CELL_VALUE_KINDS.has(kind) && r !== null && c !== null ? cellValue(store, r, c, sheetId) : null,
      replay: isPlainData(args) ? { kind: 'command', command: kind, args: cloneData(args) } : null,
    };
  }

  // 其余有身份的命令（图表/图片/整块数据等）：只有位置展示，不可重放
  if (kind !== null) return { target: kindTarget(kind, args), value: null, replay: null };

  // 没有稳定身份、也不属于任何已知形状：不做任何猜测
  return null;
}

/** 重放载荷对应的展示目标（与采样时的 target 格式一致）。 */
export function replayTarget(payload: ReplayPayload): string | null {
  switch (payload.kind) {
    case 'setCell':
      return cellRef(payload.r, payload.c);
    case 'insertRow':
    case 'deleteRow':
      return payload.count > 1 ? `第${payload.r + 1}-${payload.r + payload.count}行` : `第${payload.r + 1}行`;
    case 'insertCol':
    case 'deleteCol':
      return payload.count > 1 ? `第${payload.c + 1}-${payload.c + payload.count}列` : `第${payload.c + 1}列`;
    case 'command': {
      // 未知命令名（可能是更新版本导出的时间线）不猜测位置
      if (!COMMAND_PAYLOAD_KINDS.has(payload.command)) return null;
      const args = typeof payload.args === 'object' && payload.args !== null && !Array.isArray(payload.args)
        ? (payload.args as Record<string, unknown>)
        : {};
      return kindTarget(payload.command, args);
    }
  }
}

/** 重放前后的单元格采样（回放条目的值显示用）。 */
export function replaySample(store: Store, payload: ReplayPayload): string | null {
  if (payload.kind !== 'setCell') {
    if (payload.kind !== 'command') return null;
    if (!COMMAND_PAYLOAD_KINDS.has(payload.command)) return null;
    const args = payload.args;
    if (typeof args !== 'object' || args === null || Array.isArray(args)) return null;
    const r = num((args as Record<string, unknown>).r);
    const c = num((args as Record<string, unknown>).c);
    if (r === null || c === null) return null;
    const sheetId = (args as Record<string, unknown>).sheetId;
    return cellValue(store, r, c, typeof sheetId === 'string' ? sheetId : undefined);
  }
  return cellValue(store, payload.r, payload.c, payload.sheetId);
}
