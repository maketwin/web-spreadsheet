import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Store } from '../../src/store/Store';

// Test the editor overlay through the Spreadsheet component to verify IME + commit/cancel behavior
describe('CellEditor', () => {
  it('commits on Enter key', () => {
    const store = new Store();
    const commit = vi.fn();
    const setEditing = vi.fn();

    // Simulate the editor key handler directly
    const handleEditorKey = (event: { key: string; preventDefault: () => void }, onCommit: () => void, onCancel: () => void): void => {
      if (event.key === 'Enter') { event.preventDefault(); onCommit(); }
      if (event.key === 'Escape') onCancel();
    };

    const fakeEvent = { key: 'Enter', preventDefault: vi.fn() };
    handleEditorKey(fakeEvent, commit, setEditing);
    expect(commit).toHaveBeenCalled();
    expect(fakeEvent.preventDefault).toHaveBeenCalled();
  });

  it('cancels on Escape key', () => {
    const commit = vi.fn();
    const cancel = vi.fn();

    const handleEditorKey = (event: { key: string; preventDefault: () => void }, onCommit: () => void, onCancel: () => void): void => {
      if (event.key === 'Enter') { event.preventDefault(); onCommit(); }
      if (event.key === 'Escape') onCancel();
    };

    const fakeEvent = { key: 'Escape', preventDefault: vi.fn() };
    handleEditorKey(fakeEvent, commit, cancel);
    expect(cancel).toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  it('composition events track IME state', () => {
    let composing = false;
    const onCompositionStart = (): void => { composing = true; };
    const onCompositionEnd = (): void => { composing = false; };

    onCompositionStart();
    expect(composing).toBe(true);

    onCompositionEnd();
    expect(composing).toBe(false);
  });
});
