/**
 * Excel 数字组「增加/减少小数位数」的格式串推导。
 *
 * 规则（对齐 Excel）：
 * - 常规（general）：增加 → `0.0`；减少 → 无操作；
 * - 内置 `number` / `percent`：先落到等价自定义串（`#,##0.00` / `0.00%`）再调；
 * - 自定义格式：对第一节（`;` 前）的小数位 `0`/`#` 增减一个 `0`，小数位清空时
 *   连同 `.` 一起去掉；无小数点时往整数数字位后插入 `.0`（`%` 之前）；
 * - `currency` / `date` / `time` / `scientific`：本实现不支持逐位调整，返回 null。
 *
 * 返回 null 表示无操作（按钮按下无变化），与 Excel 在不可调格式上的表现一致。
 * 小数位上限 30（Excel 同）。
 */
export function adjustDecimalPlaces(current: string | undefined, delta: 1 | -1): string | null {
  const MAX_FRAC = 30;
  let fmt = current ?? 'general';
  if (fmt === 'general') return delta === 1 ? '0.0' : null;
  if (fmt === 'number') fmt = '#,##0.00';
  else if (fmt === 'percent') fmt = '0.00%';
  else if (fmt === 'currency' || fmt === 'date' || fmt === 'time' || fmt === 'scientific') return null;

  // Operate on the first section only (Excel adjusts the positive section).
  const semi = fmt.indexOf(';');
  const head = semi < 0 ? fmt : fmt.slice(0, semi);
  const tail = semi < 0 ? '' : fmt.slice(semi);

  const fracMatch = /\.([0#]+)/.exec(head);
  if (fracMatch !== null) {
    const frac = fracMatch[1]!;
    if (delta === 1) {
      if (frac.length >= MAX_FRAC) return null;
      const next = head.slice(0, fracMatch.index) + '.' + frac + '0' + head.slice(fracMatch.index + 1 + frac.length);
      return next + tail;
    }
    // decrease: drop the last frac digit; empty frac drops the dot as well
    const nextFrac = frac.slice(0, -1);
    const replaced = nextFrac.length === 0
      ? head.slice(0, fracMatch.index) + head.slice(fracMatch.index + 1 + frac.length)
      : head.slice(0, fracMatch.index) + '.' + nextFrac + head.slice(fracMatch.index + 1 + frac.length);
    return replaced + tail;
  }

  if (delta === -1) return null; // integer-only custom format: nothing to decrease
  // No decimal point: insert `.0` after the last integer digit-token run.
  const runs = [...head.matchAll(/[0#]+/g)];
  const last = runs[runs.length - 1];
  if (last === undefined) return null;
  const at = (last.index ?? 0) + last[0].length;
  return head.slice(0, at) + '.0' + head.slice(at) + tail;
}
