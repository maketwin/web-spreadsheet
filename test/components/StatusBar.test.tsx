import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBar } from '../../src/components/StatusBar';
import { Store } from '../../src/store/Store';

describe('StatusBar', () => {
  it('shows cell count and zoom', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'Hello', value: 'Hello' });
    store.setCell(1, 0, { text: '42', value: 42 });

    render(<StatusBar store={store} selected={null} zoom={100} />);

    expect(screen.getByText(/单元格: 2/)).toBeTruthy();
    expect(screen.getByText('100%')).toBeTruthy();
  });

  it('shows selection stats for multi-cell selection', () => {
    const store = new Store();
    store.setCell(0, 0, { text: '10', value: 10 });
    store.setCell(0, 1, { text: '20', value: 20 });

    render(<StatusBar store={store} selected={{ r1: 0, c1: 0, r2: 0, c2: 1 }} zoom={75} />);

    expect(screen.getByText(/求和: 30/)).toBeTruthy();
    expect(screen.getByText(/平均: 15.00/)).toBeTruthy();
    expect(screen.getByText(/计数: 2/)).toBeTruthy();
    expect(screen.getByText('75%')).toBeTruthy();
  });
});
