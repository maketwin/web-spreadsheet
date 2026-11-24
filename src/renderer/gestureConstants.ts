/** Shared touch-gesture timing — BottomBar's sheet-tab long-press must match
 * the canvas's, so the value lives here once instead of as two magic numbers.
 * Split out of CanvasRenderer so non-renderer importers don't pull the whole
 * 2000-line class module just for two constants. */
export const LONG_PRESS_MS = 550;
export const LONG_PRESS_SLOP = 12;
