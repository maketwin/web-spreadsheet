import type { FC, KeyboardEvent as ReactKeyboardEvent, MutableRefObject } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { Selection } from '../selection/Selection';
import { selectionLabel } from '../selection/Selection';
import type { RichTextRun, RunStyle } from '../types';
import { isRich, normalizeRuns, runsFromText } from '../util/richText';
import { runSpanStyle, runStyleFromElement } from '../util/runStyleCss';

export interface FormulaBarHandle {
  /** Flat selection in the formula field; null when unfocused / unavailable. */
  getSelection(): { readonly start: number; readonly end: number } | null;
  getValue(): string;
  focus(): void;
  /** Underlying element (input or contenteditable). */
  readonly el: HTMLElement | null;
}

export interface FormulaBarProps {
  readonly selected: Selection | null;
  readonly value: string;
  /** Character runs for text constants (Excel formula bar shows formatting). */
  readonly runs?: readonly RichTextRun[] | undefined;
  readonly onChange: (value: string, runs?: readonly RichTextRun[]) => void;
  readonly onCommit: (value?: string, fillSelection?: boolean) => void;
  readonly onGoTo?: (input: string) => void;
  /** Legacy input ref kept for callers that still expect HTMLInputElement; prefer handleRef. */
  readonly inputRef?: MutableRefObject<HTMLInputElement | null>;
  readonly handleRef?: MutableRefObject<FormulaBarHandle | null>;
  readonly onCharStyleKey?: (key: 'bold' | 'italic' | 'underline') => void;
  readonly onCancel?: () => void;
}

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

export const FormulaBar: FC<FormulaBarProps> = ({
  selected, value, runs, onChange, onCommit, onGoTo, inputRef, handleRef, onCharStyleKey, onCancel,
}) => {
  const label = selectionLabel(selected);
  const [nameInput, setNameInput] = useState(label);
  const [editingName, setEditingName] = useState(false);
  const plainRef = useRef<HTMLInputElement | null>(null);
  const richRef = useRef<HTMLDivElement | null>(null);
  const useRich = runs !== undefined && isRich(runs) && !value.startsWith('=');

  useEffect(() => { if (!editingName) setNameInput(label); }, [label, editingName]);

  // Keep rich DOM in sync when runs change from outside (cell switch / toolbar).
  useEffect(() => {
    const root = richRef.current;
    if (!useRich || root === null || runs === undefined) return;
    if (document.activeElement === root) return; // don't clobber caret while typing
    renderFormulaRuns(root, runs);
  }, [useRich, runs, value]);

  useEffect(() => {
    const handle: FormulaBarHandle = {
      getSelection: () => {
        if (useRich) {
          const root = richRef.current;
          return root === null ? null : flatSelectionOf(root);
        }
        const input = plainRef.current;
        if (input === null) return null;
        return { start: input.selectionStart ?? 0, end: input.selectionEnd ?? 0 };
      },
      getValue: () => {
        if (useRich) {
          const root = richRef.current;
          return root === null ? value : flatText(root);
        }
        return plainRef.current?.value ?? value;
      },
      focus: () => { (useRich ? richRef.current : plainRef.current)?.focus(); },
      get el() { return useRich ? richRef.current : plainRef.current; },
    };
    if (handleRef !== undefined) handleRef.current = handle;
    if (inputRef !== undefined) inputRef.current = useRich ? null : plainRef.current;
    return () => {
      if (handleRef !== undefined) handleRef.current = null;
    };
  }, [useRich, value, handleRef, inputRef]);

  const onRichInput = (): void => {
    const root = richRef.current;
    if (root === null) return;
    const next = flatText(root);
    const nextRuns = normalizeRuns(runsFromDom(root)) ?? runsFromText(next) ?? [{ text: next }];
    onChange(next, nextRuns);
  };

  const keyHandlers = (getVal: () => string) => (event: ReactKeyboardEvent) => {
    if (event.key === 'Enter') {
      // IME confirm (keyCode 229) must not commit the pre-composition text.
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      const fill = (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey;
      onCommit(getVal(), fill);
    }
    if (event.key === 'Escape') { event.preventDefault(); onCancel?.(); (event.target as HTMLElement).blur(); }
    if ((event.ctrlKey || event.metaKey) && !event.altKey) {
      const key = event.key.toLowerCase();
      if (key === 'b' || key === 'i' || key === 'u') {
        event.preventDefault();
        onCharStyleKey?.(key === 'b' ? 'bold' : key === 'i' ? 'italic' : 'underline');
      }
    }
  };

  return (
    <div className="ss-formula-bar">
      <input
        className="ss-formula-name"
        aria-label="Selected cell"
        title="名称框：输入 A1、B2:D5 或命名区域后回车跳转"
        value={editingName ? nameInput : label}
        onFocus={(event) => { setEditingName(true); setNameInput(label); requestAnimationFrame(() => event.target.select()); }}
        onChange={(event) => setNameInput(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); onGoTo?.(nameInput); }
          if (event.key === 'Escape') { setEditingName(false); event.currentTarget.blur(); }
        }}
        onBlur={() => setEditingName(false)}
      />
      <span aria-hidden />
      <span className="ss-formula-fx" title="Insert function" aria-hidden>ƒx</span>
      {useRich ? (
        <div
          ref={(el) => {
            richRef.current = el;
            if (el !== null && runs !== undefined && el.childNodes.length === 0) renderFormulaRuns(el, runs);
          }}
          className="ss-formula-input ss-formula-input--rich"
          role="textbox"
          aria-label="Formula bar"
          contentEditable
          suppressContentEditableWarning
          onInput={onRichInput}
          onKeyDown={keyHandlers(() => richRef.current === null ? value : flatText(richRef.current))}
          onBlur={(event) => {
            const next = event.relatedTarget as HTMLElement | null;
            if (next === null || next.closest('.ss-interaction-toolbar, .ss-menu-bar, .ant-dropdown, .ant-popover') === null) {
              // collapse selection visually — keep caret at end of selection
            }
          }}
        />
      ) : (
        <input
          ref={(el) => { plainRef.current = el; if (inputRef !== undefined) inputRef.current = el; }}
          className="ss-formula-input"
          aria-label="Formula bar"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={keyHandlers(() => plainRef.current?.value ?? value)}
          onBlur={(event) => {
            const next = event.relatedTarget as HTMLElement | null;
            if (next === null || next.closest('.ss-interaction-toolbar, .ss-menu-bar, .ant-dropdown, .ant-popover') === null) {
              const input = event.currentTarget;
              const pos = input.selectionEnd ?? input.value.length;
              input.setSelectionRange(pos, pos);
            }
          }}
        />
      )}
    </div>
  );
};

function renderFormulaRuns(root: HTMLElement, runs: readonly RichTextRun[]): void {
  root.replaceChildren();
  for (const run of runs) {
    const span = document.createElement('span');
    const css = runSpanStyle(run.style ?? {});
    if (css !== '') span.setAttribute('style', css);
    span.textContent = run.text;
    root.appendChild(span);
  }
  if (runs.length === 0) root.appendChild(document.createTextNode(''));
}

function runsFromDom(root: HTMLElement): RichTextRun[] {
  const out: RichTextRun[] = [];
  const walk = (node: Node, inherited: RunStyle): void => {
    if (node.nodeType === TEXT_NODE) {
      const text = node.textContent ?? '';
      if (text !== '') out.push(Object.keys(inherited).length > 0 ? { text, style: { ...inherited } } : { text });
      return;
    }
    if (node.nodeType === ELEMENT_NODE) {
      const el = node as HTMLElement;
      if (el.tagName.toLowerCase() === 'br') { out.push({ text: '\n' }); return; }
      const next = { ...inherited, ...runStyleFromElement(el) };
      for (const child of Array.from(el.childNodes)) walk(child, next);
    }
  };
  for (const child of Array.from(root.childNodes)) walk(child, {});
  return out.length > 0 ? out : [{ text: '' }];
}

function flatText(root: HTMLElement): string {
  // Walk the DOM instead of innerText: jsdom has no innerText, and the walk
  // stays consistent with runsFromDom (spans per run, <br> for newlines).
  let out = '';
  const walk = (node: Node): void => {
    if (node.nodeType === TEXT_NODE) { out += node.textContent ?? ''; return; }
    if (node.nodeType === ELEMENT_NODE) {
      const el = node as HTMLElement;
      if (el.tagName.toLowerCase() === 'br') { out += '\n'; return; }
      for (const child of Array.from(el.childNodes)) walk(child);
    }
  };
  for (const child of Array.from(root.childNodes)) walk(child);
  return out.replace(/\u00a0/g, ' ');
}

function flatSelectionOf(root: HTMLElement): { start: number; end: number } | null {
  const sel = typeof window !== 'undefined' ? window.getSelection() : null;
  if (sel === null || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;
  const pre = range.cloneRange();
  pre.selectNodeContents(root);
  pre.setEnd(range.startContainer, range.startOffset);
  const start = pre.toString().length;
  const end = start + range.toString().length;
  return { start, end };
}
