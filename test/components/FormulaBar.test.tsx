import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FormulaBar } from '../../src/components/FormulaBar';
import { cellSelection } from '../../src/selection/Selection';

describe('FormulaBar', () => {
  it('displays the selected cell reference and value', () => {
    const selected = cellSelection(2, 1); // B3
    render(<FormulaBar selected={selected} value="hello" onChange={() => {}} onCommit={() => {}} />);

    expect(screen.getByLabelText('Selected cell')).toHaveValue('B3');
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


  it('cancels on Escape', () => {
    const onCancel = vi.fn();
    const selected = cellSelection(0, 0);
    render(<FormulaBar selected={selected} value="x" onChange={() => {}} onCommit={() => {}} onCancel={onCancel} />);
    fireEvent.keyDown(screen.getByLabelText('Formula bar'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });

  it('the first click into an unfocused name box selects its text on the next frame, without touching a cleared currentTarget', () => {
    // React nulls `event.currentTarget` once the handler returns: the deferred
    // select must run on the element the handler kept, or it throws.
    const queued: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => { queued.push(callback); return queued.length; });
    const selected = cellSelection(0, 0);
    render(<FormulaBar selected={selected} value="x" onChange={() => {}} onCommit={() => {}} />);
    const nameBox = screen.getByLabelText('Selected cell') as HTMLInputElement;
    const select = vi.spyOn(nameBox, 'select');

    fireEvent.mouseDown(nameBox);
    expect(select).not.toHaveBeenCalled();
    expect(queued).toHaveLength(1);
    expect(() => queued.splice(0).forEach((callback) => callback(0))).not.toThrow();
    expect(select).toHaveBeenCalledTimes(1);

    // A click on the already-focused name box places the caret instead: the
    // mouse-down handler queues nothing (focusing it queues its own select-all).
    nameBox.focus();
    queued.splice(0).forEach((callback) => callback(0));
    fireEvent.mouseDown(nameBox);
    expect(queued).toHaveLength(0);
    expect(select).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });
});
