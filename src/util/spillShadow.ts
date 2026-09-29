import type { Cell } from '../types';

/**
 * Spill shadow cells (`spillOf` set) are DERIVED state written by the formula
 * engine, not user content. Any path that moves or copies cells as data must
 * drop them: the anchor formula re-registers at its destination (batch end)
 * and re-spills fresh shadows there. Transporting a shadow as data leaves a
 * stale value that blocks the re-spill (the anchor shows #SPILL!) and carries
 * an anchor key that may no longer host an anchor.
 *
 * Undo snapshots are the exception — they restore the exact pre-command
 * state, anchor and its shadows together, and the engine's idempotent writer
 * accepts them without another pass.
 */
export function isSpillShadow(cell: Cell | undefined): boolean {
  return cell?.spillOf !== undefined;
}
