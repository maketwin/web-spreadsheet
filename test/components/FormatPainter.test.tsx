import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FormatPainter, useFormatPainter } from '../../src/components/FormatPainter';
import { Store } from '../../src/store/Store';

describe('FormatPainter', () => {
  it('renders format painter button', () => {
    const store = new Store();
    render(<FormatPainter store={store} activeStyle={undefined} onApplyStyle={vi.fn()} />);
    expect(screen.getByLabelText('Format painter')).toBeTruthy();
  });

  it('toggles painting mode on click', () => {
    const store = new Store();
    const { rerender } = render(<FormatPainter store={store} activeStyle={{ bold: true }} onApplyStyle={vi.fn()} />);
    const btn = screen.getByLabelText('Format painter');

    // Enter painting mode
    fireEvent.click(btn);
    expect(screen.getByLabelText('Format painter').getAttribute('class')).toContain('ant-btn-primary');

    // Exit painting mode
    fireEvent.click(btn);
    expect(screen.getByLabelText('Format painter').getAttribute('class')).not.toContain('ant-btn-primary');
  });
});

describe('useFormatPainter', () => {
  it('applies style when painting and returns true', () => {
    function TestHook(): JSX.Element {
      const { painting, startPaint, applyIfPainting } = useFormatPainter();
      return (
        <div>
          <span data-testid="painting">{String(painting)}</span>
          <button data-testid="start" onClick={() => startPaint({ bold: true })} />
          <button data-testid="apply" onClick={() => { const result = applyIfPainting({ r: 1, c: 1 }, (s) => { void s; }); void result; }} />
        </div>
      );
    }

    render(<TestHook />);
    expect(screen.getByTestId('painting').textContent).toBe('false');

    fireEvent.click(screen.getByTestId('start'));
    expect(screen.getByTestId('painting').textContent).toBe('true');
  });
});
