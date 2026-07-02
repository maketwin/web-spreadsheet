import { useEffect, useRef, type FC } from 'react';
import { Chart, registerables } from 'chart.js';
import type { ChartSpec } from './types';
import type { Store } from '../store/Store';

Chart.register(...registerables);

export interface ChartPanelProps {
  readonly spec: ChartSpec;
  readonly store: Store;
  readonly onClose: () => void;
}

export const ChartPanel: FC<ChartPanelProps> = ({ spec, store, onClose }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    if (canvasRef.current === null) return undefined;
    const data = readChartData(store, spec);
    const chart = new Chart(canvasRef.current, {
      type: spec.type,
      data,
      options: {
        responsive: true,
        plugins: {
          title: { display: spec.title !== undefined, text: spec.title ?? '' },
          legend: { display: spec.type === 'pie' },
        },
      },
    });
    chartRef.current = chart;
    return () => { chart.destroy(); chartRef.current = null; };
  }, [spec, store]);

  return (
    <div className="ss-chart-panel">
      <div className="ss-chart-panel-header">
        <span>{spec.title ?? '图表'}</span>
        <button type="button" className="ss-chart-close" onClick={onClose}>×</button>
      </div>
      <canvas ref={canvasRef} />
    </div>
  );
};

function readChartData(store: Store, spec: ChartSpec): import('chart.js').ChartData {
  const { r1, c1, r2, c2 } = parseRangeKey(spec.range);
  const labels: string[] = [];
  const datasets: import('chart.js').ChartData['datasets'] = [];

  for (let c = c1; c <= c2; c += 1) {
    const headerCell = store.getCell(r1, c);
    const label = headerCell?.text ?? '';
    labels.push(label);
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
