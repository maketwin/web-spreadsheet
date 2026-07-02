import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BottomBar } from '../src/components/BottomBar';
import { Toolbar } from '../src/components/Toolbar';
import type { SheetInfo } from '../src/store/Store';

describe('a11y: ARIA roles and labels', () => {
  it('BottomBar has tablist and tab roles', () => {
    const sheets: readonly SheetInfo[] = [
      { id: 's1', name: 'Sheet1' },
      { id: 's2', name: 'Sheet2' },
    ];
    render(<BottomBar sheets={sheets} activeSheetId="s2" />);

    expect(screen.getByRole('tablist', { name: 'Spreadsheet sheets' })).toBeInTheDocument();
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(2);
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
  });

  it('Toolbar has toolbar role with labeled buttons', () => {
    render(<Toolbar />);

    expect(screen.getByRole('toolbar', { name: 'Spreadsheet toolbar' })).toBeInTheDocument();
    expect(screen.getByLabelText('Bold')).toBeInTheDocument();
    expect(screen.getByLabelText('Italic')).toBeInTheDocument();
    expect(screen.getByLabelText('Underline')).toBeInTheDocument();
    expect(screen.getByLabelText('Font size')).toBeInTheDocument();
    expect(screen.getByLabelText('Alignment')).toBeInTheDocument();
    expect(screen.getByLabelText('Toggle dark mode')).toBeInTheDocument();
  });

  it('canvas element has accessible label', () => {
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-label', 'Spreadsheet canvas, use arrow keys to navigate');
    canvas.setAttribute('tabindex', '0');
    document.body.append(canvas);

    expect(canvas.getAttribute('aria-label')).toBe('Spreadsheet canvas, use arrow keys to navigate');
    expect(canvas.tabIndex).toBe(0);
    canvas.remove();
  });
});
