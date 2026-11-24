import { afterEach, describe, expect, it } from 'vitest';
import { COL_HEADER_HEIGHT, ROW_HEADER_WIDTH } from '../../src/renderer/coordinate';
import { GridGeometry } from '../../src/renderer/GridGeometry';
import { FreezeManager } from '../../src/freeze/FreezeManager';
import { Store } from '../../src/store/Store';
import { VirtualScroller } from '../../src/renderer/VirtualScroller';
import { TOTAL_COLS, TOTAL_ROWS } from '../../src/util/gridSize';

const CELL_W = 64;
const CELL_H = 20;

function makeCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'clientWidth', { configurable: true, value: 300 });
  Object.defineProperty(canvas, 'clientHeight', { configurable: true, value: 150 });
  Object.defineProperty(canvas, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ left: 10, top: 20, width: 300, height: 150, right: 310, bottom: 170, x: 10, y: 20, toJSON: () => ({}) }),
  });
  document.body.append(canvas);
  return canvas;
}

function makeGeometry(frozenRows = 0, frozenCols = 0): { geom: GridGeometry; scroller: VirtualScroller; store: Store } {
  const canvas = makeCanvas();
  const scroller = new VirtualScroller({ totalRows: TOTAL_ROWS, totalCols: TOTAL_COLS, defaultRowHeight: CELL_H, defaultColWidth: CELL_W, viewportW: 300, viewportH: 150 });
  const freeze = new FreezeManager({ totalRows: TOTAL_ROWS, totalCols: TOTAL_COLS });
  if (frozenRows > 0 || frozenCols > 0) freeze.freezeAt(frozenRows, frozenCols);
  const store = new Store();
  const geom = new GridGeometry({ canvas, scroller, freeze, store, zoom: () => 1, gridW: () => 260, gridH: () => 110, vpW: () => 300, vpH: () => 150, scrollBy: () => {} });
  return { geom, scroller, store };
}

describe('GridGeometry', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('cellVP offsets by headers and follows scroll without freeze', () => {
    const { geom, scroller } = makeGeometry();
    expect(geom.cellVP(0, 0)).toEqual({ x: ROW_HEADER_WIDTH, y: COL_HEADER_HEIGHT });
    scroller.setScroll(40, 20);
    expect(geom.cellVP(1, 1)).toEqual({ x: ROW_HEADER_WIDTH + CELL_W - 20, y: COL_HEADER_HEIGHT + CELL_H - 40 });
  });

  it('cellVP keeps frozen rows/cols pinned under scroll (Excel quadrant model)', () => {
    const { geom, scroller } = makeGeometry(2, 1);
    scroller.setScroll(100, 100);
    // Frozen cell (0,0) never moves.
    expect(geom.cellVP(0, 0)).toEqual({ x: ROW_HEADER_WIDTH, y: COL_HEADER_HEIGHT });
    // Scrollable cell slides under the frozen strips: header + frozenW + (pixel - frozenW - scroll).
    expect(geom.frozenW()).toBe(CELL_W);
    expect(geom.frozenH()).toBe(CELL_H * 2);
    expect(geom.cellVP(2, 1)).toEqual({ x: ROW_HEADER_WIDTH + CELL_W - 100, y: COL_HEADER_HEIGHT + CELL_H * 2 - 100 });
  });

  it('colAtViewportX/rowAtViewportY map headers to null and frozen cells without scroll', () => {
    const { geom, scroller } = makeGeometry(1, 1);
    expect(geom.colAtViewportX(ROW_HEADER_WIDTH - 1)).toBeNull();
    expect(geom.rowAtViewportY(COL_HEADER_HEIGHT - 1)).toBeNull();
    expect(geom.colAtViewportX(ROW_HEADER_WIDTH)).toBe(0);
    expect(geom.rowAtViewportY(COL_HEADER_HEIGHT)).toBe(0);
    // Scrollable pane: content coordinate = freeze edge + scroll + local offset.
    scroller.setScroll(0, 30);
    expect(geom.colAtViewportX(ROW_HEADER_WIDTH + CELL_W + 10)).toBe(1);
    expect(geom.rowAtViewportY(COL_HEADER_HEIGHT + CELL_H)).toBe(1);
  });

  it('pointerCell returns null over headers and past content end', () => {
    const { geom, scroller } = makeGeometry();
    // Header corner (canvas sits at client left 10, top 20).
    expect(geom.pointerCell(10, 20)).toBeNull();
    // First grid cell.
    expect(geom.pointerCell(10 + ROW_HEADER_WIDTH + 1, 20 + COL_HEADER_HEIGHT + 1)).toEqual({ r: 0, c: 0 });
    // Far past the scrollable content end.
    scroller.setScroll(1e9, 1e9);
    expect(geom.pointerCell(10 + ROW_HEADER_WIDTH + 200, 20 + COL_HEADER_HEIGHT + 100)).toBeNull();
  });

  it('headerAtPoint classifies sheet corner / column / row headers', () => {
    const { geom } = makeGeometry();
    expect(geom.headerAtPoint(10 + 5, 20 + 5)).toEqual({ type: 'sheet' });
    expect(geom.headerAtPoint(10 + ROW_HEADER_WIDTH + 5, 20 + 5)).toEqual({ type: 'column', c: 0 });
    expect(geom.headerAtPoint(10 + 5, 20 + COL_HEADER_HEIGHT + 5)).toEqual({ type: 'row', r: 0 });
    expect(geom.headerAtPoint(10 + ROW_HEADER_WIDTH + 5, 20 + COL_HEADER_HEIGHT + 5)).toBeNull();
  });

  it('getCellViewportRect expands to the whole merged area', () => {
    const { geom, store } = makeGeometry();
    store.addMerge('A1:B2');
    expect(geom.getCellViewportRect(0, 0)).toEqual({ x: ROW_HEADER_WIDTH, y: COL_HEADER_HEIGHT, w: CELL_W * 2, h: CELL_H * 2 });
    expect(geom.getCellViewportRect(2, 3)).toEqual({ x: ROW_HEADER_WIDTH + CELL_W * 3, y: COL_HEADER_HEIGHT + CELL_H * 2, w: CELL_W, h: CELL_H });
  });

  it('clampToViewport intersects with the CSS box and floors at zero', () => {
    const { geom } = makeGeometry();
    expect(geom.clampToViewport({ x: -10, y: -10, w: 100, h: 100 })).toEqual({ x: 0, y: 0, w: 90, h: 90 });
    expect(geom.clampToViewport({ x: 400, y: 200, w: 50, h: 50 })).toEqual({ x: 400, y: 200, w: 0, h: 0 });
  });

  it('moveTargetFromPointer clamps a move to the freeze region of its source', () => {
    const { geom } = makeGeometry(2, 2);
    // Source fully inside the frozen band → target must stay inside rows/cols 0..1.
    const target = geom.moveTargetFromPointer({ source: { r1: 0, c1: 0, r2: 1, c2: 1 }, offset: { r: 0, c: 0 } }, { r: 50, c: 50 });
    expect(target).toEqual({ r: 0, c: 0 });
    // Source fully in the scrollable pane → target stays at/after the freeze edge.
    const target2 = geom.moveTargetFromPointer({ source: { r1: 5, c1: 5, r2: 5, c2: 5 }, offset: { r: 0, c: 0 } }, { r: 0, c: 0 });
    expect(target2).toEqual({ r: 2, c: 2 });
  });
});
