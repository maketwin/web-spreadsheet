import { useEffect, useRef, useState, type FC, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Chart, registerables, type ChartData } from 'chart.js';

Chart.register(...registerables);
import type { Store } from '../store/Store';
import type { CanvasRenderer } from '../renderer/CanvasRenderer';
import { COL_HEADER_HEIGHT, ROW_HEADER_WIDTH, TOTAL_COLS, TOTAL_ROWS } from '../renderer/coordinate';
import { normalizeAnchor } from './geometry';
import { CHART_MIN_H, CHART_MIN_W, type ChartAnchor, type ChartSpec } from './types';

export interface FloatingChartProps {
  readonly spec: ChartSpec;
  readonly store: Store;
  /** Live renderer — the source of truth for anchor ⇄ pixel conversion. */
  readonly renderer: CanvasRenderer | null;
  readonly selected: boolean;
  readonly onSelect: (id: string | null) => void;
  /** Commit a gesture (drag/resize/nudge) as one undoable anchor change. */
  readonly onGeometry: (id: string, anchor: ChartAnchor) => void;
  readonly onRemove: (id: string) => void;
  /** Excel: Ctrl+Z / Ctrl+Y undo and redo while a chart object has focus. */
  readonly onUndo?: (() => void) | undefined;
  readonly onRedo?: (() => void) | undefined;
}

type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
interface Gesture {
  readonly mode: 'move' | HandleId;
  readonly startClientX: number;
  readonly startClientY: number;
  readonly startRect: Rect;
}

interface Rect { x: number; y: number; w: number; h: number }

const HANDLES: readonly HandleId[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const HANDLE_CURSOR: Readonly<Record<HandleId, string>> = {
  nw: 'nwse-resize', n: 'ns-resize', ne: 'nesw-resize', e: 'ew-resize',
  se: 'nwse-resize', s: 'ns-resize', sw: 'nesw-resize', w: 'ew-resize',
};

/**
 * A chart as an Excel-style floating object: positioned over the grid by a
 * two-cell anchor, selectable, draggable, resizable from 8 handles, removed
 * with Delete. Chart.js draws the plot itself.
 */
export const FloatingChart: FC<FloatingChartProps> = ({ spec, store, renderer, selected, onSelect, onGeometry, onRemove, onUndo, onRedo }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const elRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const liveRectRef = useRef<Rect | null>(null);
  /** Live px rect while a gesture is in flight; overrides the anchor-derived position. */
  const [liveRect, setLiveRect] = useState<Rect | null>(null);
  liveRectRef.current = liveRect;
  const anchor = spec.anchor ?? legacyAnchor(spec);

  // Chart.js plot (redrawn when the spec or data changes).
  useEffect(() => {
    if (canvasRef.current === null) return undefined;
    const data = readChartData(store, spec);
    const chart = new Chart(canvasRef.current, {
      type: spec.type,
      data,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          title: { display: spec.title !== undefined, text: spec.title ?? '', color: '#444', font: { size: 12, weight: 600 } },
          legend: { display: spec.type === 'pie', labels: { boxWidth: 12, font: { size: 10 } } },
        },
      },
    });
    chartRef.current = chart;
    return () => { chart.destroy(); chartRef.current = null; };
  }, [spec, store]);

  // Keep DOM position glued to the anchor even when only the canvas scrolls
  // (scroll does not re-render React). Direct style writes avoid re-render churn.
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

  // Selection takes keyboard focus so Delete/Esc/arrows land here (Excel semantics).
  useEffect(() => {
    if (selected) elRef.current?.focus({ preventScroll: true });
  }, [selected]);

  const onGestureMove = (e: PointerEvent): void => {
    const g = gestureRef.current;
    if (g === null) return;
    setLiveRect(applyGesture(g, e.clientX - g.startClientX, e.clientY - g.startClientY));
  };

  const onGestureUp = (): void => {
    window.removeEventListener('pointermove', onGestureMove);
    window.removeEventListener('pointerup', onGestureUp);
    const g = gestureRef.current;
    gestureRef.current = null;
    setLiveRect(null);
    if (g === null || renderer === null) return;
    onGeometry(spec.id, commitAnchor(renderer, liveRectRef.current ?? g.startRect));
  };

  // If the component unmounts mid-gesture, drop the window listeners instead
  // of leaving them alive until the next pointerup.
  useEffect(() => {
    return () => {
      window.removeEventListener('pointermove', onGestureMove);
      window.removeEventListener('pointerup', onGestureUp);
      gestureRef.current = null;
    };
  });

  const beginGesture = (e: ReactPointerEvent<HTMLElement>, mode: Gesture['mode']): void => {
    if (renderer === null || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    onSelect(spec.id);
    elRef.current?.focus({ preventScroll: true });
    const baseRect = liveRect ?? renderer.chartRect(anchor);
    gestureRef.current = { mode, startClientX: e.clientX, startClientY: e.clientY, startRect: baseRect };
    setLiveRect(baseRect);
    window.addEventListener('pointermove', onGestureMove);
    window.addEventListener('pointerup', onGestureUp);
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
    // Plain arrow: 1px nudge (Shift: 10px). Ctrl/⌘+arrow: one default cell.
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
      className={`ss-chart-object${selected ? ' ss-chart-object--selected' : ''}`}
      style={style}
      tabIndex={selected ? 0 : -1}
      role="img"
      aria-label={spec.title ?? '图表'}
      onPointerDown={(e) => beginGesture(e, 'move')}
      onKeyDown={onKeyDown}
    >
      <canvas ref={canvasRef} />
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

function applyGesture(g: Gesture, dx: number, dy: number): Rect {
  const minW = CHART_MIN_W;
  const minH = CHART_MIN_H;
  if (g.mode === 'move') return { x: g.startRect.x + dx, y: g.startRect.y + dy, w: g.startRect.w, h: g.startRect.h };
  let { x, y, w, h } = g.startRect;
  if (g.mode.includes('e')) w = Math.max(minW, g.startRect.w + dx);
  if (g.mode.includes('s')) h = Math.max(minH, g.startRect.h + dy);
  if (g.mode.includes('w')) { const right = g.startRect.x + g.startRect.w; x = Math.min(right - minW, g.startRect.x + dx); w = right - x; }
  if (g.mode.includes('n')) { const bottom = g.startRect.y + g.startRect.h; y = Math.min(bottom - minH, g.startRect.y + dy); h = bottom - y; }
  return { x, y, w, h };
}

/** Clamp a gesture rect into the grid client area and snap it back to an anchor. */
function commitAnchor(renderer: CanvasRenderer, rect: Rect): ChartAnchor {
  const grid = renderer.gridClientRect();
  const x = Math.min(Math.max(rect.x, grid.x), Math.max(grid.x, grid.x + grid.w - CHART_MIN_W));
  const y = Math.min(Math.max(rect.y, grid.y), Math.max(grid.y, grid.y + grid.h - CHART_MIN_H));
  const w = Math.max(CHART_MIN_W, Math.min(rect.w, grid.x + grid.w - x));
  const h = Math.max(CHART_MIN_H, Math.min(rect.h, grid.y + grid.h - y));
  return normalizeAnchor(renderer.anchorFromRect({ x, y, w, h }), TOTAL_ROWS, TOTAL_COLS);
}

/** Panel-era charts carry no anchor — park them below/right of their data range. */
function legacyAnchor(spec: ChartSpec): ChartAnchor {
  const parts = spec.range.split(':');
  const end = parts[1]?.split(',').map(Number) ?? [0, 0];
  const r = Math.min((end[0] ?? 0) + 1, TOTAL_ROWS - 14);
  const c = Math.min((end[1] ?? 0) + 1, TOTAL_COLS - 9);
  return {
    from: { r, c, offX: 0, offY: 0 },
    to: { r: r + 13, c: c + 8, offX: 0, offY: 0 },
  };
}

function readChartData(store: Store, spec: ChartSpec): ChartData {
  const { r1, c1, r2, c2 } = parseRangeKey(spec.range);
  const labels: string[] = [];
  const datasets: ChartData['datasets'] = [];

  for (let c = c1; c <= c2; c += 1) {
    const headerCell = store.getCell(r1, c);
    labels.push(headerCell?.text ?? '');
  }

  for (let r = r1 + 1; r <= r2; r += 1) {
    const rowHeader = store.getCell(r, c1);
    const values: number[] = [];
    for (let c = c1; c <= c2; c += 1) {
      const cell = store.getCell(r, c);
      values.push(typeof cell?.value === 'number' ? cell.value : Number(cell?.text ?? 0));
    }
    datasets.push({
      label: rowHeader?.text ?? `系列 ${r - r1}`,
      data: values,
      backgroundColor: palette(r - r1 - 1),
      borderColor: palette(r - r1 - 1),
      tension: 0.2,
    });
  }

  return { labels, datasets };
}

function palette(index: number): string {
  const colors = [
    'rgba(54, 162, 235, 0.7)',
    'rgba(255, 99, 132, 0.7)',
    'rgba(75, 192, 192, 0.7)',
    'rgba(255, 206, 86, 0.7)',
    'rgba(153, 102, 255, 0.7)',
  ];
  return colors[index % colors.length] ?? colors[0]!;
}

function parseRangeKey(range: string): { readonly r1: number; readonly c1: number; readonly r2: number; readonly c2: number } {
  const parts = range.split(':');
  const start = parts[0]?.split(',').map(Number) ?? [0, 0];
  const end = parts[1]?.split(',').map(Number) ?? start;
  return { r1: start[0] ?? 0, c1: start[1] ?? 0, r2: end[0] ?? 0, c2: end[1] ?? 0 };
}
