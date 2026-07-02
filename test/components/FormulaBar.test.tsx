import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FormulaBar } from '../../src/components/FormulaBar';
import { cellSelection } from '../../src/selection/Selection';

describe('FormulaBar', () => {
  it('displays the selected cell reference and value', () => {
    const selected = cellSelection(2, 1); // B3
    render(<FormulaBar selected={selected} value="hello" onChange={() => {}} onCommit={() => {}} />);

    expect(screen.getByLabelText('Selected cell')).toHaveTextContent('B3');
    expect(screen.getByLabelText('Formula bar')).toHaveValue('hello');
  });

  it('displays formula when value starts with =', () => {
    const selected = cellSelection(0, 0); // A1
    render(<FormulaBar selected={selected} value="=SUM(1,2)" onChange={() => {}} onCommit={() => {}} />);

    expect(screen.getByLabelText('Formula bar')).toHaveValue('=SUM(1,2)');
  });

  it('commits edited value on Enter', () => {
    const onCommit = vi.fn();
    const onChange = vi.fn();
    const selected = cellSelection(0, 0);
    render(<FormulaBar selected={selected} value="42" onChange={onChange} onCommit={onCommit} />);

    const input = screen.getByLabelText('Formula bar');
    fireEvent.change(input, { target: { value: '99' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onChange).toHaveBeenCalledWith('99');
    expect(onCommit).toHaveBeenCalled();
  });
});
