import { act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Spreadsheet } from '../src/index';

/** jsdom canvases have no 2D context; the renderer only needs these calls to exist. */
function installCanvasContext(): void {
  const ctx: Partial<CanvasRenderingContext2D> = {
    beginPath: vi.fn(),
    clip: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    rect: vi.fn(),
    restore: vi.fn(),
    save: vi.fn(),
    scale: vi.fn(),
    setLineDash: vi.fn(),
    setTransform: vi.fn(),
    strokeRect: vi.fn(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as CanvasRenderingContext2D);
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
}

describe('Spreadsheet root resolution', () => {
  const instances: Spreadsheet[] = [];

  function mount(root: HTMLElement | string): Spreadsheet {
    const spreadsheet = new Spreadsheet(root, { data: [['A1']], theme: false });
    instances.push(spreadsheet);
    act(() => spreadsheet.mount());
    return spreadsheet;
  }

  afterEach(() => {
    for (const spreadsheet of instances.splice(0)) act(() => spreadsheet.destroy());
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('mounts into the element a CSS selector matches (the README example)', () => {
    installCanvasContext();
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root')!;

    mount('#root');

    expect(root.querySelector('.ss-root')).toBeInTheDocument();
  });

  it('accepts a class selector (first match) and an element reference', () => {
    installCanvasContext();
    document.body.innerHTML = '<section class="sheet-host"></section><article class="sheet-host"></article><main></main>';
    const firstHost = document.querySelector('section.sheet-host')!;
    const secondHost = document.querySelector('article.sheet-host')!;
    const main = document.querySelector('main')!;

    mount('.sheet-host');
    mount(main);

    expect(firstHost.querySelector('.ss-root')).toBeInTheDocument();
    expect(secondHost.querySelector('.ss-root')).toBeNull();
    expect(main.querySelector('.ss-root')).toBeInTheDocument();
  });

  it('still resolves a bare element id, ahead of a tag of the same name', () => {
    installCanvasContext();
    document.body.innerHTML = '<app></app><div id="app"></div>';
    const byId = document.getElementById('app')!;

    mount('app');

    expect(byId.querySelector('.ss-root')).toBeInTheDocument();
    expect(document.querySelector('app')!.children).toHaveLength(0);
  });

  it('throws a descriptive error when neither an id nor a selector matches', () => {
    expect(() => new Spreadsheet('#missing', { theme: false })).toThrow(Error);
    expect(() => new Spreadsheet('#missing', { theme: false })).toThrow(/挂载根元素未找到/);
    expect(() => new Spreadsheet('#missing', { theme: false })).toThrow(/"#missing"/);
    expect(() => new Spreadsheet('#missing', { theme: false })).toThrow(/CSS 选择器/);
  });

  it('throws a descriptive error for a string that is not a valid selector', () => {
    expect(() => new Spreadsheet('#', { theme: false })).toThrow(Error);
    expect(() => new Spreadsheet('#', { theme: false })).toThrow(/不是合法的 CSS 选择器/);
  });

  it('rejects a match that is not an HTMLElement', () => {
    document.body.innerHTML = '<svg id="icon"></svg>';

    expect(() => new Spreadsheet('#icon', { theme: false })).toThrow(/必须是 HTMLElement.*<svg>/);
  });
});
