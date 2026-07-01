import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Toolbar } from '../../src/components/Toolbar';

describe('Toolbar', () => {
  it('renders at least 3 buttons', () => {
    render(<Toolbar />);

    expect(screen.getAllByRole('button').length).toBeGreaterThanOrEqual(3);
  });
});
