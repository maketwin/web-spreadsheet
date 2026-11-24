import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Chart } from 'chart.js';
import { FloatingChart } from '../../src/charts/FloatingChart';
import type { ChartSpec } from '../../src/charts/types';
import { Store } from '../../src/store/Store';

vi.mock('chart.js', () => {
  class FakeChart {
    static register(): void {}
    /** Every chart still alive, newest last. */
    static live: FakeChart[] = [];
    data: unknown;
    update = vi.fn();
    constructor(public canvas: HTMLCanvasElement, public config: unknown) {
      this.data = (config as { data?: unknown }).data;
      FakeChart.live.push(this);
    }
    destroy(): void { FakeChart.live = FakeChart.live.filter((chart) => chart !== this); }
  }
  return { Chart: FakeChart, registerables: [] };
});

const anchor = { from: { r: 1, c: 1, offX: 0, offY: 0 }, to: { r: 5, c: 5, offX: 0, offY: 0 } };
const spec: ChartSpec = {
  id: 'chart-theme',
  type: 'pie',
  range: '0,0:2,2',
  title: '季度',
  anchor,
};
const barSpec: ChartSpec = { id: 'chart-theme-bar', type: 'bar', range: '0,0:2,2', title: '柱状', anchor };

/** Stubs getComputedStyle so the theme reads the given token values. */
const stubThemeTokens = (tokens: Record<string, string>): void => {
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: (n: string) => tokens[n] ?? '' }));
};

/** Config of the newest live (not destroyed) chart. */
const latestConfig = (): { options: { plugins: { title: { color: string }; legend: { labels: { color: string } } } } } =>
  (Chart as unknown as { live: Array<{ config: unknown }> }).live.at(-1)!.config as { options: { plugins: { title: { color: string }; legend: { labels: { color: string } } } } };

describe('FloatingChart theme colors', () => {
  let store: Store;

  beforeEach(() => {
    store = new Store();
    store.setCell(0, 0, { text: 'Q1' });
    store.setCell(1, 0, { text: '10', value: 10 });
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('titles and legend use the theme text color', () => {
    stubThemeTokens({ '--ss-text': '#f3f3f3' });
    // The coordinate theme cache may hold values from an earlier render — invalidate.
    window.dispatchEvent(new CustomEvent('ss:theme-changed'));

    render(<FloatingChart spec={spec} store={store} renderer={null} selected={false} onSelect={() => {}} onGeometry={() => {}} onRemove={() => {}} />);

    const config = latestConfig();
    expect(config.options.plugins.title.color).toBe('#f3f3f3');
    expect(config.options.plugins.legend.labels.color).toBe('#f3f3f3');
  });

  it('in dark mode the axis ticks and grid lines carry the dark token colors', () => {
    stubThemeTokens({ '--ss-text': '#f3f3f3', '--ss-chart-tick': '#b3b3b3', '--ss-chart-grid': '#2b2b2b' });
    window.dispatchEvent(new CustomEvent('ss:theme-changed'));

    render(<FloatingChart spec={barSpec} store={store} renderer={null} selected={false} onSelect={() => {}} onGeometry={() => {}} onRemove={() => {}} />);

    const config = latestConfig();
    expect(config.options.plugins.title.color).toBe('#f3f3f3');
    const options = config.options as { scales?: Record<string, { ticks: { color: string }; grid: { color: string } }> };
    for (const axis of ['x', 'y']) {
      expect(options.scales?.[axis]?.ticks.color).toBe('#b3b3b3');
      expect(options.scales?.[axis]?.grid.color).toBe('#2b2b2b');
    }
  });

  it('in light mode the axis colors equal the chart.js defaults', () => {
    stubThemeTokens({ '--ss-text': '#000000' });
    window.dispatchEvent(new CustomEvent('ss:theme-changed'));

    render(<FloatingChart spec={barSpec} store={store} renderer={null} selected={false} onSelect={() => {}} onGeometry={() => {}} onRemove={() => {}} />);

    const options = latestConfig().options as { scales?: Record<string, { ticks: { color: string }; grid: { color: string } }> };
    for (const axis of ['x', 'y']) {
      expect(options.scales?.[axis]?.ticks.color).toBe('#666666');
      expect(options.scales?.[axis]?.grid.color).toBe('#e5e5e5');
    }
  });

  it('pie charts define no scales (they have no axes)', () => {
    stubThemeTokens({ '--ss-text': '#f3f3f3' });
    window.dispatchEvent(new CustomEvent('ss:theme-changed'));

    render(<FloatingChart spec={spec} store={store} renderer={null} selected={false} onSelect={() => {}} onGeometry={() => {}} onRemove={() => {}} />);

    const options = latestConfig().options as { scales?: unknown };
    expect(options.scales).toBeUndefined();
  });

  it('rebuilds the chart with the new text color when the theme changes', () => {
    let textColor = '#f3f3f3';
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: (n: string) => (n === '--ss-text' ? textColor : '') }));
    window.dispatchEvent(new CustomEvent('ss:theme-changed'));

    const view = render(<FloatingChart spec={spec} store={store} renderer={null} selected={false} onSelect={() => {}} onGeometry={() => {}} onRemove={() => {}} />);
    expect(latestConfig().options.plugins.title.color).toBe('#f3f3f3');
    const firstChart = (Chart as unknown as { live: unknown[] }).live.at(-1);

    textColor = '#000000';
    act(() => { window.dispatchEvent(new CustomEvent('ss:theme-changed')); });

    const live = (Chart as unknown as { live: unknown[] }).live;
    expect(live.length).toBe(1); // old chart destroyed, exactly one rebuild alive
    expect(live.at(-1)).not.toBe(firstChart);
    expect(latestConfig().options.plugins.title.color).toBe('#000000');
    expect(latestConfig().options.plugins.legend.labels.color).toBe('#000000');
    view.unmount();
  });
});
