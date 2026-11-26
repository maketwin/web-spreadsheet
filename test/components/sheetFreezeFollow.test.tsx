import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Store } from '../../src/store/Store';
import type { ViewState } from '../../src/components/keyboard';
import type { EditingCell } from '../../src/components/EditorOverlay';
import { useCanvasRenderer } from '../../src/components/hooks/useCanvasRenderer';
import { useSheetFreeze } from '../../src/components/hooks/useSheetFreeze';
import { CanvasRenderer } from '../../src/renderer/CanvasRenderer';

const initial: ViewState = { zoom: 100, showFormula: false, showGrid: true, frozenRows: 0, frozenCols: 0 };

interface FixtureApi {
  /** 视图侧切冻结（与 Spreadsheet.tsx 的菜单路径一致：setView，写回由 useSheetFreeze 完成）。 */
  setFrozen: (rows: number, cols: number) => void;
  getView: () => ViewState;
}

/**
 * 真实渲染器管线的最小挂载：useSheetFreeze + useCanvasRenderer，
 * 断言"store 上的冻结 → 视图 → renderer.setFreeze"整条链路。
 */
function Fixture({ store, sheetId, api }: { store: Store; sheetId: string; api: { current: FixtureApi | null } }): ReactElement {
  const [view, setView] = useState<ViewState>(initial);
  useSheetFreeze(store, sheetId, view, setView);
  const editingRef = useRef<EditingCell | null>(null);
  const revealRef = useRef(false);
  const { canvasRef } = useCanvasRenderer(store, null, revealRef, () => undefined, () => undefined, view, setView, undefined, () => undefined, () => undefined, () => undefined, editingRef);
  useEffect(() => {
    api.current = {
      setFrozen: (rows: number, cols: number) => setView((current) => ({ ...current, frozenRows: rows, frozenCols: cols })),
      getView: () => view,
    };
  });
  return <canvas ref={canvasRef} width={300} height={150} />;
}

/** jsdom 没有 2D 上下文：给 CanvasRenderer 一个什么都不画的桩。 */
function stubCanvas(): void {
  const ctx = {
    beginPath: vi.fn(), clip: vi.fn(), fillRect: vi.fn(), fillText: vi.fn(), lineTo: vi.fn(),
    measureText: vi.fn(() => ({ width: 24 }) as TextMetrics),
    moveTo: vi.fn(), rect: vi.fn(), restore: vi.fn(), save: vi.fn(),
    scale: vi.fn(), setLineDash: vi.fn(), setTransform: vi.fn(), stroke: vi.fn(), strokeRect: vi.fn(),
    clearRect: vi.fn(), drawImage: vi.fn(), arc: vi.fn(), closePath: vi.fn(), strokeText: vi.fn(), fill: vi.fn(),
    translate: vi.fn(), rotate: vi.fn(), ellipse: vi.fn(), bezierCurveTo: vi.fn(), quadraticCurveTo: vi.fn(),
    createLinearGradient: vi.fn(() => ({ addColorStop: () => undefined })),
    createPattern: vi.fn(() => null),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0);
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
}

describe('视图跟随外部设置的冻结窗格', () => {
  beforeEach(() => {
    stubCanvas();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('宿主对活动表直接 setFreeze：视图重载、渲染器收到新冻结，表上的冻结保持不变且不回声', () => {
    const store = new Store();
    const api: { current: FixtureApi | null } = { current: null };
    const rendererSetFreeze = vi.spyOn(CanvasRenderer.prototype, 'setFreeze');
    render(<Fixture store={store} sheetId={store.getActiveSheetId()} api={api} />);
    const storeSetFreeze = vi.spyOn(store, 'setFreeze');

    act(() => { store.setFreeze({ rows: 2, cols: 0 }); });

    // 渲染器收到冻结（画布分隔线随之出现）
    expect(rendererSetFreeze).toHaveBeenCalledWith(2, 0);
    expect(rendererSetFreeze).toHaveBeenLastCalledWith(2, 0);
    // 表上的冻结保持宿主设置的值——没有被视图写回覆盖
    expect(store.getFreeze()).toEqual({ rows: 2, cols: 0 });
    // 除宿主那一次调用外，视图没有再写回 Store（无事件→视图→写回→事件回声）
    expect(storeSetFreeze).toHaveBeenCalledTimes(1);
    expect(api.current?.getView().frozenRows).toBe(2);
    expect(api.current?.getView().frozenCols).toBe(0);
  });

  it('另一张表的 freeze 事件不影响当前视图', () => {
    const store = new Store();
    const first = store.getActiveSheetId();
    const other = store.addSheet('Other'); // addSheet 激活了新表，切回第一张再挂载
    store.activateSheet(first);
    const api: { current: FixtureApi | null } = { current: null };
    const rendererSetFreeze = vi.spyOn(CanvasRenderer.prototype, 'setFreeze');
    render(<Fixture store={store} sheetId={first} api={api} />);

    act(() => { store.setFreeze({ rows: 5, cols: 5 }, other); });

    expect(api.current?.getView().frozenRows).toBe(0);
    expect(api.current?.getView().frozenCols).toBe(0);
    expect(rendererSetFreeze).not.toHaveBeenCalledWith(5, 5);
    expect(store.getFreeze(other)).toEqual({ rows: 5, cols: 5 });
  });

  it('视图侧切换冻结仍然只写回 Store 一次', () => {
    const store = new Store();
    const api: { current: FixtureApi | null } = { current: null };
    render(<Fixture store={store} sheetId={store.getActiveSheetId()} api={api} />);
    const storeSetFreeze = vi.spyOn(store, 'setFreeze');
    const first = store.getActiveSheetId();

    act(() => { api.current?.setFrozen(3, 0); });

    expect(storeSetFreeze).toHaveBeenCalledTimes(1);
    expect(storeSetFreeze).toHaveBeenCalledWith({ rows: 3, cols: 0 }, first);
    expect(store.getFreeze(first)).toEqual({ rows: 3, cols: 0 });
    expect(api.current?.getView().frozenRows).toBe(3);

    act(() => { api.current?.setFrozen(0, 0); });
    // 取消冻结 + 事件重载一轮：第二次写回之后不能再有第三次
    expect(storeSetFreeze).toHaveBeenCalledTimes(2);
    expect(store.getFreeze(first)).toBeUndefined();
  });

  it('切换活动表时视图跟随新表的冻结（渲染器一并收到）', () => {
    const store = new Store();
    const first = store.getActiveSheetId();
    const second = store.addSheet('Second');
    store.setFreeze({ rows: 1, cols: 2 }, second);
    store.activateSheet(first); // addSheet 激活了新表，切回来再挂载
    const api: { current: FixtureApi | null } = { current: null };
    const rendererSetFreeze = vi.spyOn(CanvasRenderer.prototype, 'setFreeze');
    const { rerender } = render(<Fixture store={store} sheetId={first} api={api} />);
    expect(api.current?.getView().frozenRows).toBe(0);

    act(() => { rerender(<Fixture store={store} sheetId={second} api={api} />); });

    expect(api.current?.getView().frozenRows).toBe(1);
    expect(api.current?.getView().frozenCols).toBe(2);
    expect(rendererSetFreeze).toHaveBeenLastCalledWith(1, 2);
    // 各表互不覆盖
    expect(store.getFreeze(second)).toEqual({ rows: 1, cols: 2 });

    act(() => { rerender(<Fixture store={store} sheetId={first} api={api} />); });
    expect(api.current?.getView().frozenRows).toBe(0);
    expect(store.getFreeze(second)).toEqual({ rows: 1, cols: 2 });
  });
});
