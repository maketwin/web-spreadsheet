import { type FC, useMemo } from 'react';
import type { SparklineType } from './types';

export interface SparklineProps {
  readonly data: readonly number[];
  readonly type: SparklineType;
  readonly width?: number;
  readonly height?: number;
}

const W = 60;
const H = 20;

export const Sparkline: FC<SparklineProps> = ({ data, type, width = W, height = H }) => {
  if (data.length === 0) return <span style={{ width, height, display: 'inline-block' }} />;

  const svg = useMemo(() => renderSvg(data, type, width, height), [data, type, width, height]);
  return <span style={{ width, height, display: 'inline-block' }} dangerouslySetInnerHTML={{ __html: svg }} />;
};

function renderSvg(data: readonly number[], type: SparklineType, w: number, h: number): string {
  if (type === 'line') return renderLine(data, w, h);
  if (type === 'bar') return renderBar(data, w, h);
  return renderWinLoss(data, w, h);
}

function renderLine(data: readonly number[], w: number, h: number): string {
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pad = 1;
  const usableH = h - pad * 2;
  const step = (w - pad * 2) / Math.max(data.length - 1, 1);

  const points = data.map((v, i) => {
    const x = pad + i * step;
    const y = pad + usableH - ((v - min) / range) * usableH;
    return `${x},${y}`;
  }).join(' ');

  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><polyline points="${points}" fill="none" stroke="#4A90D9" stroke-width="1.5"/></svg>`;
}

function renderBar(data: readonly number[], w: number, h: number): string {
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pad = 1;
  const usableH = h - pad * 2;
  const barW = Math.max((w - pad * 2) / data.length - 1, 1);
  const gap = 1;

  const rects = data.map((v, i) => {
    const barH = Math.max(((v - min) / range) * usableH, 1);
    const x = pad + i * (barW + gap);
    const y = pad + usableH - barH;
    return `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" fill="#4A90D9"/>`;
  }).join('');

  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">${rects}</svg>`;
}

function renderWinLoss(data: readonly number[], w: number, h: number): string {
  const mid = h / 2;
  const barH = mid - 1;
  const pad = 1;
  const barW = Math.max((w - pad * 2) / data.length - 1, 1);
  const gap = 1;

  const rects = data.map((v, i) => {
    const win = v >= 0;
    const x = pad + i * (barW + gap);
    const y = win ? mid - barH : mid;
    return `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" fill="${win ? '#4A90D9' : '#D94A4A'}"/>`;
  }).join('');

  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><line x1="0" y1="${mid}" x2="${w}" y2="${mid}" stroke="#CCC" stroke-width="0.5"/>${rects}</svg>`;
}
