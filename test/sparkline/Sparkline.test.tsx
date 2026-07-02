import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Sparkline } from '../../src/sparkline/Sparkline';

describe('Sparkline', () => {
  it('renders line sparkline', () => {
    const { container } = render(<Sparkline data={[1, 3, 2, 5, 4]} type="line" />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.querySelector('polyline')).not.toBeNull();
  });

  it('renders bar sparkline', () => {
    const { container } = render(<Sparkline data={[1, 3, 2, 5, 4]} type="bar" />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    const rects = svg?.querySelectorAll('rect');
    expect(rects?.length).toBe(5);
  });

  it('renders win-loss sparkline', () => {
    const { container } = render(<Sparkline data={[1, -2, 3, -1, 0]} type="winloss" />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    const rects = svg?.querySelectorAll('rect');
    expect(rects?.length).toBe(5);
  });

  it('renders empty container for empty data', () => {
    const { container } = render(<Sparkline data={[]} type="line" />);
    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelector('span')).not.toBeNull();
  });

  it('uses custom width and height', () => {
    const { container } = render(<Sparkline data={[1, 2, 3]} type="line" width={100} height={30} />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('100');
    expect(svg?.getAttribute('height')).toBe('30');
  });
});
