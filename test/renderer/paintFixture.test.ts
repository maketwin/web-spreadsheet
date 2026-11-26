import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CanvasRenderer } from '../../src/renderer/CanvasRenderer';
import { Store } from '../../src/store/Store';

/**
 * Pixel-equivalence fixture for the million-row scale refactor of the render
 * pipeline. One deterministic scene (cells, row/col meta incl. hidden rows and
 * columns, a merge, wrapped/rich text, a bordered cell, freeze panes, a
 * selection, a scroll) is painted through recording canvas contexts, and the
 * full ordered sequence of canvas calls is compared call-by-call against a
 * baseline captured before the refactor. Any drawing change — geometry, clip
 * rects, colors, order — breaks the sequence.
 *
 * Regenerate the baseline with `UPDATE_FIXTURE=1 vitest run` (only after an
 * intentional, reviewed drawing change).
 */

/** Vitest always runs from the repo root, so a cwd-relative path is stable. */
const FIXTURE_PATH = resolve('test/renderer/__fixtures__/paintSequence.json');

/** One recorded canvas call (`m`/`a`) or property assignment (`s`/`v`). */
type Entry = { m: string; a?: unknown[] } | { s: string; v: unknown };

function serializeArg(v: unknown): unknown {
  if (v instanceof HTMLCanvasElement) return '<canvas>';
  return v;
}

const RECORDED_PROPS = ['fillStyle', 'strokeStyle', 'lineWidth', 'textAlign', 'textBaseline', 'font', 'lineDashOffset', 'globalAlpha'] as const;

function makeRecordingCtx(record: Entry[]): CanvasRenderingContext2D {
  const call = (name: string) => (...args: unknown[]) => { record.push({ m: name, a: args.map(serializeArg) }); };
  const ctx: Record<string, unknown> = {
    beginPath: call('beginPath'),
    clip: call('clip'),
    closePath: call('closePath'),
    fillRect: call('fillRect'),
    fillText: call('fillText'),
    strokeRect: call('strokeRect'),
    moveTo: call('moveTo'),
    lineTo: call('lineTo'),
    stroke: call('stroke'),
    save: call('save'),
    restore: call('restore'),
    rect: call('rect'),
    setLineDash: call('setLineDash'),
    setTransform: call('setTransform'),
    scale: call('scale'),
    translate: call('translate'),
    rotate: call('rotate'),
    clearRect: call('clearRect'),
    drawImage: call('drawImage'),
    arc: call('arc'),
    fill: call('fill'),
    // Deterministic text metrics: width strictly derived from the string.
    measureText: (text: string) => {
      record.push({ m: 'measureText', a: [text] });
      return { width: text.length * 7 } as TextMetrics;
    },
  };
  for (const prop of RECORDED_PROPS) {
    let value: unknown = prop === 'lineWidth' ? 1 : prop === 'globalAlpha' ? 1 : '';
    Object.defineProperty(ctx, prop, {
      get: () => value,
      set: (v: unknown) => { value = v; record.push({ s: prop, v }); },
      configurable: true,
    });
  }
  return ctx as unknown as CanvasRenderingContext2D;
}

/** Blit snapshot target: must work (drawImage/clearRect checks) but stays unrecorded. */
function makeSilentCtx(): CanvasRenderingContext2D {
  return {
    clearRect: () => undefined,
    drawImage: () => undefined,
    setTransform: () => undefined,
    save: () => undefined,
    restore: () => undefined,
  } as unknown as CanvasRenderingContext2D;
}

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

function buildScene(store: Store): void {
  // Plain overflow into empty neighbors (textOverflowSpan scan to the right).
  store.setCell(0, 0, { text: 'Overflowing plain header text' });
  store.setCell(0, 2, { text: 'B2', styleId: 'bold' });
  store.setStyle('bold', { bold: true });
  // Plain wrapped text (multi-line height in a default row).
  store.setCell(1, 0, { text: 'plain wrapped fairly long text', styleId: 'pw' });
  store.setStyle('pw', { wrap: true });
  // Number format + right align.
  store.setCell(1, 3, { text: '1234.5', value: 1234.5, styleId: 'nf' });
  store.setStyle('nf', { numberFormat: '0.00', align: 'right' });
  // Bordered + filled cell (style borders suppress grid-line segments).
  store.setCell(2, 1, { text: 'bordered', styleId: 'bd' });
  store.setStyle('bd', { border: { top: '#217346', left: '#217346' }, bgcolor: '#fff3cd' });
  // Right-aligned overflow scans to the LEFT through empty cells.
  store.setCell(4, 4, { text: 'right aligned long text', styleId: 'ra' });
  store.setStyle('ra', { align: 'right' });
  // Merge with anchor styling (text only paints from the anchor).
  store.addMerge('B4:C5');
  store.setCell(3, 1, { text: 'merged area', styleId: 'mg' });
  store.setStyle('mg', { bgcolor: '#e2efda', align: 'center' });
  // Rich text, wrapped (shared rich layout path).
  store.setCell(5, 0, {
    text: 'rich wrapped text that is long',
    richText: [{ text: 'rich ' }, { text: 'wrapped text that is long', style: { bold: true } }],
    styleId: 'rw',
  });
  store.setStyle('rw', { wrap: true });
  // Rich text, unwrapped (rich overflow path).
  store.setCell(7, 1, {
    text: 'rich overflow runs',
    richText: [{ text: 'rich ', style: { color: '#c00000' } }, { text: 'overflow runs' }],
  });
  // Row/column meta: explicit heights, hidden row/column, narrow column.
  store.setRow(2, { height: 44 });
  store.setRow(6, { hide: true });
  store.setRow(9, { height: 12 });
  store.setCol(1, { width: 120 });
  store.setCol(5, { hide: true });
  store.setCol(3, { width: 40 });
}

/** Paint the scene through the real renderer, returning the full canvas call sequence. */
function recordFrameSequence(): Entry[] {
  const record: Entry[] = [];
  const mainCtx = makeRecordingCtx(record);
  const overlayCtx = makeRecordingCtx(record);
  const silentCtx = makeSilentCtx();
  const canvas = makeCanvas();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((function (this: HTMLCanvasElement) {
    if (this === canvas) return mainCtx;
    if (this.className === 'ss-overlay-canvas') return overlayCtx;
    return silentCtx;
  }) as unknown as typeof HTMLCanvasElement.prototype.getContext);
  const callbacks: FrameRequestCallback[] = [];
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { callbacks.push(cb); return callbacks.length; });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);

  const store = new Store();
  buildScene(store);
  const renderer = new CanvasRenderer({
    canvas,
    store,
    devicePixelRatio: 1,
    selectedRange: { r1: 0, c1: 0, r2: 2, c2: 2 },
    selectionKind: 'range',
    activeCell: { r: 1, c: 1 },
  });
  callbacks[0]?.(0); // frame 1: full paint at scroll origin + blit snapshot
  renderer.setFreeze(1, 1);
  renderer.scrollBy(30, 45);
  callbacks[1]?.(16); // frame 2: scrolled repaint under freeze panes
  renderer.destroy();
  return record;
}

describe('paint pipeline pixel-equivalence fixture (pre-scale baseline)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('paints the exact canvas call sequence recorded before the scale refactor', () => {
    const actual = recordFrameSequence();
    expect(actual.length).toBeGreaterThan(100); // sanity: a real frame was recorded
    if (process.env.UPDATE_FIXTURE === '1') {
      mkdirSync(dirname(FIXTURE_PATH), { recursive: true });
      writeFileSync(FIXTURE_PATH, JSON.stringify(actual, null, 1));
      return;
    }
    expect(existsSync(FIXTURE_PATH), 'fixture missing — regenerate once with UPDATE_FIXTURE=1').toBe(true);
    const expected = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as Entry[];
    expect(actual).toEqual(expected);
  });
});
