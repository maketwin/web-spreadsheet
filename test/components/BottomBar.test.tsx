import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BottomBar } from '../../src/components/BottomBar';

describe('BottomBar', () => {
  it('renders sheet switch buttons', () => {
    render(<BottomBar sheets={['Sheet1', 'Sheet2']} activeSheet="Sheet2" />);

    expect(screen.getByRole('tab', { name: 'Sheet1' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Sheet2' })).toHaveAttribute('aria-selected', 'true');
  });
});
