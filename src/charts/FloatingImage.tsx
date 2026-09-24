import { useEffect, useRef, useState, type FC, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { type ChartAnchor, type ImageSpec } from './types';
import type { CanvasRenderer } from '../renderer/CanvasRenderer';
import { ROW_HEADER_WIDTH, COL_HEADER_HEIGHT } from '../renderer/coordinate';
import { applyGesture, commitAnchor, HANDLES, HANDLE_CURSOR, type Gesture, type Rect } from './FloatingChart';

export interface FloatingImageProps {
  readonly spec: ImageSpec;
  readonly renderer: CanvasRenderer | null;
  readonly selected: boolean;
  readonly onSelect: (id: string | null) => void;
  /** Commit a drag/resize gesture as one undoable anchor change. */
  readonly onGeometry: (id: string, anchor: ChartAnchor) => void;
  readonly onRemove: (id: string) => void;
  readonly onUndo?: (() => void) | undefined;
  readonly onRedo?: (() => void) | undefined;
}

/** Floating image object: same interaction model as FloatingChart — anchored to
 * cells, selectable, draggable, resizable from 8 handles, removed with Delete. */
export const FloatingImage: FC<FloatingImageProps> = ({ spec, renderer, selected, onSelect, onGeometry, onRemove, onUndo, onRedo }) => {
  const elRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const liveRectRef = useRef<Rect | null>(null);
  const [liveRect, setLiveRect] = useState<Rect | null>(null);
  const anchor = spec.anchor;

  // Keep DOM position glued to the anchor even when only the canvas scrolls.
  useEffect(() => {
    if (renderer === null) return undefined;
    let raf = 0;
    let lastKey = '';
    const tick = (): void => {
      const el = elRef.current;
      if (el !== null && gestureRef.current === null) {
        const rect = renderer.chartRect(anchor);
        const key = `${Math.round(rect.x * 2)},${Math.round(rect.y * 2)},${Math.round(rect.w * 2)},${Math.round(rect.h * 2)}`;
        if (key !== lastKey) {
          lastKey = key;
          el.style.left = `${rect.x - ROW_HEADER_WIDTH}px`;
          el.style.top = `${rect.y - COL_HEADER_HEIGHT}px`;
          el.style.width = `${rect.w}px`;
          el.style.height = `${rect.h}px`;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [renderer, anchor]);

  useEffect(() => {
    if (selected) elRef.current?.focus({ preventScroll: true });
  }, [selected]);

  const onGestureMove = (e: PointerEvent): void => {
    const g = gestureRef.current;
    if (g === null) return;
    setLiveRect(applyGesture(g, e.clientX - g.startClientX, e.clientY - g.startClientY));
  };

  const onGestureUp = (): void => {
    window.removeEventListener('pointermove', stableMove.current);
    window.removeEventListener('pointerup', stableUp.current);
    const g = gestureRef.current;
    gestureRef.current = null;
    setLiveRect(null);
    if (g === null || renderer === null) return;
    onGeometry(spec.id, commitAnchor(renderer, liveRectRef.current ?? g.startRect));
  };

  const moveRef = useRef(onGestureMove);
  const upRef = useRef(onGestureUp);
  moveRef.current = onGestureMove;
  upRef.current = onGestureUp;
  const stableMove = useRef((e: PointerEvent) => { moveRef.current(e); });
  const stableUp = useRef(() => { upRef.current(); });

  useEffect(() => {
    const move = stableMove.current;
    const up = stableUp.current;
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      gestureRef.current = null;
    };
  }, []);

  const beginGesture = (e: ReactPointerEvent<HTMLElement>, mode: Gesture['mode']): void => {
    if (renderer === null || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    onSelect(spec.id);
    elRef.current?.focus({ preventScroll: true });
    const baseRect = liveRect ?? renderer.chartRect(anchor);
    gestureRef.current = { mode, startClientX: e.clientX, startClientY: e.clientY, startRect: baseRect };
    setLiveRect(baseRect);
    window.addEventListener('pointermove', stableMove.current);
    window.addEventListener('pointerup', stableUp.current);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) onRedo?.(); else onUndo?.();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      onRedo?.();
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      onRemove(spec.id);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      onSelect(null);
      return;
    }
    const deltas: Record<string, [number, number]> = {
      ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
    };
    const delta = deltas[e.key];
    if (delta === undefined || renderer === null) return;
    e.preventDefault();
    const step: [number, number] = (e.ctrlKey || e.metaKey)
      ? [delta[0] !== 0 ? Math.sign(delta[0]) * renderer.defaultCellWidth() : 0, delta[1] !== 0 ? Math.sign(delta[1]) * renderer.defaultCellHeight() : 0]
      : [delta[0] * (e.shiftKey ? 10 : 1), delta[1] * (e.shiftKey ? 10 : 1)];
    const rect = liveRectRef.current ?? renderer.chartRect(anchor);
    onGeometry(spec.id, commitAnchor(renderer, {
      x: rect.x + step[0],
      y: rect.y + step[1],
      w: rect.w,
      h: rect.h,
    }));
  };

  const rect = liveRect ?? renderer?.chartRect(anchor);
  const style = rect === undefined
    ? { visibility: 'hidden' as const }
    : {
      left: rect.x - ROW_HEADER_WIDTH,
      top: rect.y - COL_HEADER_HEIGHT,
      width: rect.w,
      height: rect.h,
    };

  return (
    <div
      ref={elRef}
      className={`ss-image-object${selected ? ' ss-image-object--selected' : ''}`}
      style={{ ...style, overflow: 'hidden' }}
      tabIndex={selected ? 0 : -1}
      role="img"
      aria-label={spec.name}
      onPointerDown={(e) => beginGesture(e, 'move')}
      onKeyDown={onKeyDown}
    >
      <img src={spec.src} alt={spec.name} style={{ width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none' }} draggable={false} />
      {selected && HANDLES.map((h) => (
        <div
          key={h}
          data-handle={h}
          className={`ss-chart-handle ss-chart-handle--${h}`}
          style={{ cursor: HANDLE_CURSOR[h] }}
          onPointerDown={(e) => beginGesture(e, h)}
        />
      ))}
    </div>
  );
};
