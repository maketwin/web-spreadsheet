import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { RichEditor, type RichEditorApi } from '../../src/components/RichEditor';
import type { RichTextRun } from '../../src/types';

function mountEditor(runs: readonly RichTextRun[]): { api: () => RichEditorApi; root: HTMLElement } {
  let latest: RichEditorApi | null = null;
  const { container } = render(<RichEditor initialRuns={runs} css={{}} registerApi={(api) => { latest = api; }} commit={() => {}} cancel={() => {}} />);
  const root = container.querySelector('.ss-editor-overlay--rich') as HTMLElement;
  if (latest === null) throw new Error('editor api not registered');
  return { api: () => latest!, root };
}

/** Select flat range [start, end) inside the editor root using a DOM Range. */
function selectFlat(root: HTMLElement, start: number, end: number): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let offset = 0;
  let startNode: Text | null = null;
  let endNode: Text | null = null;
  let startOffset = 0;
  let endOffset = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const len = node.textContent?.length ?? 0;
    if (startNode === null && start <= offset + len) { startNode = node; startOffset = start - offset; }
    if (endNode === null && end <= offset + len) { endNode = node; endOffset = end - offset; }
    offset += len;
  }
  if (startNode === null || endNode === null) throw new Error('selection out of range');
  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  const selection = window.getSelection();
  selection!.removeAllRanges();
  selection!.addRange(range);
}

describe('RichEditor', () => {
  it('renders one styled span per run and reports runs back', () => {
    const { api, root } = mountEditor([
      { text: '红', style: { color: '#FF0000', bold: true } },
      { text: '蓝' },
    ]);
    const spans = root.querySelectorAll('span');
    expect(spans).toHaveLength(2);
    expect(spans[0]!.getAttribute('style')).toContain('color:#FF0000');
    expect(spans[0]!.getAttribute('style')).toContain('font-weight:700');
    expect(api().getRuns()).toEqual([
      { text: '红', style: { color: '#FF0000', bold: true } },
      { text: '蓝' },
    ]);
  });

  it('hasSelection is false without a selection and true over characters', () => {
    const { api, root } = mountEditor([{ text: 'abcd' }]);
    expect(api().hasSelection()).toBe(false);
    selectFlat(root, 1, 3);
    expect(api().hasSelection()).toBe(true);
  });

  it('applyRunStyle splits the selection range and re-renders runs', () => {
    const { api, root } = mountEditor([{ text: 'abcd' }]);
    selectFlat(root, 1, 3);
    expect(api().applyRunStyle({ bold: true })).toBe(true);
    expect(api().getRuns()).toEqual([
      { text: 'a' },
      { text: 'bc', style: { bold: true } },
      { text: 'd' },
    ]);
    // the selection survives the re-render
    expect(api().hasSelection()).toBe(true);
  });

  it('applyRunStyle preserves other runs untouched', () => {
    const { api, root } = mountEditor([
      { text: '红', style: { color: '#FF0000' } },
      { text: '蓝' },
    ]);
    selectFlat(root, 1, 2);
    expect(api().applyRunStyle({ fontSize: 20 })).toBe(true);
    expect(api().getRuns()).toEqual([
      { text: '红', style: { color: '#FF0000' } },
      { text: '蓝', style: { fontSize: 20 } },
    ]);
  });

  it('applyRunStyle with a collapsed caret is a no-op', () => {
    const { api, root } = mountEditor([{ text: 'abc' }]);
    selectFlat(root, 1, 1);
    expect(api().applyRunStyle({ bold: true })).toBe(false);
    expect(api().getRuns()).toEqual([{ text: 'abc' }]);
  });
});
