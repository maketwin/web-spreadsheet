import { describe, expect, it, vi } from 'vitest';
import { autoFilterAtPoint, AUTO_FILTER_BUTTON_WIDTH, filteredRowNumberColor, paintAutoFilterIcon, type AutoFilterChromeDeps } from '../../src/renderer/AutoFilterChrome';
import type { CanvasTheme } from '../../src/renderer/coordinate';
import { Store } from '../../src/store/Store';

const theme: CanvasTheme = {
  bg: '#fff', outside: '#f3f3f3', text: '#000', grid: '#e0e0e0', selected: '#e7f1ea',
  headerBg: '#ececec', accent: '#217346', fontFamily: 'Calibri', border: '#bdbdbd', freezeLine: '#6f6f6f',
};

function stubDeps(overrides: Partial<AutoFilterChromeDeps> = {}): AutoFilterChromeDeps {
  const ctx = {} as CanvasRenderingContext2D;
  return {
    ctx,
    canvas: document.createElement('canvas'),
    store: new Store(),
    scroller: { getColWidth: () => 100, getRowHeight: () => 20 } as unknown as AutoFilterChromeDeps['scroller'],
    freeze: { getFrozenRows: () => 0, getFrozenCols: () => 0 } as unknown as AutoFilterChromeDeps['freeze'],
    cellVP: (r, c) => ({ x: 50 + c * 100, y: 20 + r * 20 }),
    frozenW: () => 0,
    frozenH: () => 0,
    vpW: () => 300,
    vpH: () => 150,
    pointerCell: () => null,
    ...overrides,
  };
}

describe('AutoFilterChrome', () => {
  it('filteredRowNumberColor: header color without criteria, blue for hidden-range survivors', () => {
    const store = new Store();
    expect(filteredRowNumberColor(store, 1, theme)).toBe('#444444');
    store.setAutoFilter({ range: { r1: 0, c1: 0, r2: 5, c2: 1 }, criteria: {} });
    expect(filteredRowNumberColor(store, 1, theme)).toBe('#444444');
    store.setAutoFilter({ range: { r1: 0, c1: 0, r2: 5, c2: 1 }, criteria: { 0: { selected: ['x'], includeBlanks: false } } });
    // Data rows below the header (r > r1) inside the filter range turn blue.
    expect(filteredRowNumberColor(store, 1, theme)).toBe('#0057C2');
    expect(filteredRowNumberColor(store, 5, theme)).toBe('#0057C2');
    expect(filteredRowNumberColor(store, 0, theme)).toBe('#444444');
    expect(filteredRowNumberColor(store, 6, theme)).toBe('#444444');
  });

  it('autoFilterAtPoint only hits the button zone of header-row cells in the filter range', () => {
    const store = new Store();
    store.setAutoFilter({ range: { r1: 0, c1: 0, r2: 5, c2: 1 }, criteria: {} });
    const deps = stubDeps({ store, pointerCell: (_x, _y) => ({ r: 0, c: 0 }) });
    // Canvas rect left = 0; cell 0 spans x 50..150; button zone = [150-16-6, 150-2] = [128, 148].
    deps.canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 150, right: 300, bottom: 150, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    expect(autoFilterAtPoint(deps, 100, 10)).toBeNull();
    expect(autoFilterAtPoint(deps, 128, 10)).toEqual({ r: 0, c: 0 });
    expect(autoFilterAtPoint(deps, 148, 10)).toEqual({ r: 0, c: 0 });
    expect(autoFilterAtPoint(deps, 149, 10)).toBeNull();
    // Header row mismatch or outside filter columns → null even in the zone.
    expect(autoFilterAtPoint(stubDeps({ store, pointerCell: () => ({ r: 1, c: 0 }) }), 128, 10)).toBeNull();
    expect(autoFilterAtPoint(stubDeps({ store, pointerCell: () => ({ r: 0, c: 5 }) }), 128, 10)).toBeNull();
    expect(AUTO_FILTER_BUTTON_WIDTH).toBe(16);
  });

  it('paintAutoFilterIcon: active funnel fills, idle chevron strokes', () => {
    const ctx = { save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(), fill: vi.fn(), stroke: vi.fn() } as unknown as CanvasRenderingContext2D;
    paintAutoFilterIcon(ctx, 100, 50, theme, true);
    expect(ctx.fill).toHaveBeenCalledTimes(1);
    expect(ctx.stroke).not.toHaveBeenCalled();
    const ctx2 = { save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(), fill: vi.fn(), stroke: vi.fn() } as unknown as CanvasRenderingContext2D;
    paintAutoFilterIcon(ctx2, 100, 50, theme, false);
    expect(ctx2.stroke).toHaveBeenCalledTimes(1);
    expect(ctx2.fill).not.toHaveBeenCalled();
  });
});
