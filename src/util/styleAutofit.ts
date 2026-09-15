import { AutoRowHeightsCommand } from './rowAutofit';
import { CompositeCommand } from './rangeValues';
import { SetRangeStyleCommand } from '../commands/impl/SetRangeStyle';

import type { Command } from '../commands/Command';
import type { Style } from '../types';
import type { RangeAddress } from '../selection/Range';

/**
 * Excel: a font size / wrap change is ONE undo step that includes the
 * row-height adjustment it triggers. Returns the composite so callers run it
 * through their usual command channel (one undo entry).
 */
export function styleWithAutofitCommand(range: RangeAddress, style: Partial<Style>): Command {
  const rect: RangeAddress = { r1: range.r1, c1: range.c1, r2: range.r2, c2: range.c2 };
  const styleCmd = new SetRangeStyleCommand({ ...rect, style });
  const autofitCmd = new AutoRowHeightsCommand(rect);
  return new CompositeCommand([styleCmd, autofitCmd]);
}
