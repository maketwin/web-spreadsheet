import { useCallback, useRef } from 'react';
import type { RangeAddress } from '../../selection/Range';

export interface MultiSelectionApi {
  readonly multiRef: { current: readonly RangeAddress[] };
  /** Wire to the renderer once it exists (assign `apiRef.current`). */
  readonly rendererApiRef: { current: { setExtraRanges: (ranges: readonly RangeAddress[]) => void } | null };
  /** Replace the extra (Ctrl-added) selection ranges and repaint. */
  readonly setMulti: (ranges: readonly RangeAddress[]) => void;
}

/** Excel multi-selection (Ctrl+click/drag): ranges beyond the main one. */
export function useMultiSelection(): MultiSelectionApi {
  const multiRef = useRef<readonly RangeAddress[]>([]);
  const rendererApiRef = useRef<{ setExtraRanges: (ranges: readonly RangeAddress[]) => void } | null>(null);
  const setMulti = useCallback((ranges: readonly RangeAddress[]) => {
    multiRef.current = ranges;
    rendererApiRef.current?.setExtraRanges(ranges);
  }, []);
  return { multiRef, rendererApiRef, setMulti };
}
