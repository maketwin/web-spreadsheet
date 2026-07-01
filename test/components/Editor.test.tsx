import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Editor } from '../../src/components/Editor';

describe('Editor', () => {
  it('renders a cell editor input', () => {
    render(<Editor value="A1" />);

    expect(screen.getByRole('textbox', { name: 'Cell editor' })).toHaveValue('A1');
  });
});
