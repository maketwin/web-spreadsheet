import type { Command } from './Command';
import type { RangeAddress } from '../selection/Range';

/**
 * Excel F4: repeat the last command re-targeted at the current selection.
 * A command is repeatable when its args carry an address we can rebind:
 * - `{r1,c1,r2,c2,...}`  range commands (styles, borders, values, sort…)
 * - `{r,c,...}`          single-cell commands (typing repeats verbatim)
 * - `{r,count?,...}`     row commands (InsertRow/DeleteRow/SetRowHeight…)
 * - `{c,count?,...}`     column commands
 * Anything else returns undefined (nothing sensible to repeat).
 */
export function repeatOnRange(cmd: Command, range: RangeAddress): Command | undefined {
  const args = (cmd as unknown as { args?: unknown }).args;
  if (args === null || typeof args !== 'object') return undefined;
  const record = args as Record<string, unknown>;
  let next: Record<string, unknown> | undefined;
  if (hasAll(record, 'r1', 'c1', 'r2', 'c2')) {
    next = { ...record, r1: range.r1, c1: range.c1, r2: range.r2, c2: range.c2 };
  } else if (typeof record['r'] === 'number' && typeof record['c'] === 'number') {
    next = { ...record, r: range.r1, c: range.c1 };
  } else if (typeof record['r'] === 'number') {
    next = { ...record, r: range.r1, ...(typeof record['count'] === 'number' ? { count: range.r2 - range.r1 + 1 } : {}) };
  } else if (typeof record['c'] === 'number') {
    next = { ...record, c: range.c1, ...(typeof record['count'] === 'number' ? { count: range.c2 - range.c1 + 1 } : {}) };
  }
  if (next === undefined) return undefined;
  const Ctor = cmd.constructor as new (args: unknown) => Command;
  return new Ctor(next);
}

function hasAll(record: Record<string, unknown>, ...keys: readonly string[]): boolean {
  return keys.every((k) => typeof record[k] === 'number');
}
