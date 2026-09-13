import { MoveRange } from './impl/MoveRange';
import type { RangeAddress } from '../selection/Range';

/** Factory for drag interactions (move / Ctrl-drag copy) so call sites stay executor-agnostic. */
export function makeMoveRange(args: { readonly source: RangeAddress; readonly target: RangeAddress; readonly copy?: boolean | undefined }): MoveRange {
  return new MoveRange({ source: args.source, target: args.target, ...(args.copy === true ? { copy: true } : {}) });
}
