import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Menu } from '../../src/components/Menu';

describe('Menu', () => {
  it('renders context menu actions', () => {
    render(<Menu />);

    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Copy' })).toBeInTheDocument();
  });
});
