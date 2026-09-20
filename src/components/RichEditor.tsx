import { useEffect, useRef } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { RichTextRun, RunStyle, Style } from '../types';
import { applyRunStyle as applyRunModel, charsAllHave, flattenRuns, insertAtRuns, mergeRuns, normalizeRuns, replaceRangeInRuns, type RunStylePatch } from '../util/richText';
import { runSpanStyle, runStyleFromElement } from '../util/runStyleCss';
import { ClipboardService } from '../clipboard/ClipboardService';

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

/**
 * In-cell rich text editor: a contenteditable overlay rendering one styled
 * span per run. The DOM is the source of truth while editing (React never
 * reconciles its children — content is set imperatively), which is what keeps
 * the caret stable and IME composition alive. Key semantics mirror the plain
 * textarea overlay: Enter commits and moves, Alt+Enter inserts a line break,
 * Tab commits and moves, Escape cancels; arrows commit in enter mode.
 */

export interface RichEditorApi {
  /** Current runs rebuilt from the DOM (post-IME, post-typing). */
  getRuns(): RichTextRun[];
  /** Editor selection as flat offsets; null when the selection is elsewhere. */
  getSelection(): { readonly start: number; readonly end: number } | null;
  /** Apply a style patch to the selection; collapsed caret toggles typing style (Excel). */
  applyRunStyle(patch: RunStylePatch): boolean;
  hasSelection(): boolean;
}

export interface RichEditorProps {
  readonly initialRuns: readonly RichTextRun[];
  readonly css: CSSProperties;
  /** Whole-cell style: bold/italic/underline toggles resolve against it. */
  readonly cellStyle?: Style | undefined;
  /** Flat selection to restore after mount (mid-edit textarea upgrade keeps the user's selection). */
  readonly initialSelection?: { readonly start: number; readonly end: number } | undefined;
  readonly editMode?: boolean;
  /** Excel: F2 while typing upgrades enter → edit mode. */
  readonly onUpgradeEditMode?: () => void;
  readonly registerApi: (api: RichEditorApi | null) => void;
  readonly commit: (moveAfter?: { readonly dr: number; readonly dc: number }, fillSelection?: boolean) => void;
  readonly cancel: () => void;
  /** Flat-text sync for the formula bar while typing. */
  readonly onValueChange?: (value: string) => void;
  /** Blur-commit decision lives in the parent (toolbar clicks must not commit). */
  readonly onBlur?: () => void;
  readonly ariaLabel?: string;
}

export function RichEditor({ initialRuns, css, cellStyle, initialSelection, editMode, registerApi, commit, cancel, onValueChange, onBlur, ariaLabel, onUpgradeEditMode }: RichEditorProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const composingRef = useRef(false);
  const runsRef = useRef<RichTextRun[]>([...initialRuns]);

  useEffect(() => {
    const root = rootRef.current;
    if (root === null) return undefined;
    renderRuns(root, runsRef.current);
    root.focus();
    if (initialSelection !== undefined) setFlatSelection(root, initialSelection.start, initialSelection.end);
    else collapseTo(root, 'end');
    const api: RichEditorApi = {
      getRuns: () => (root === null ? [] : runsRef.current),
      getSelection: () => flatSelectionOf(root),
      applyRunStyle: (patch) => applyPatchToSelection(root, patch, runsRef),
      hasSelection: () => {
        const sel = flatSelectionOf(root);
        return sel !== null && sel.end > sel.start;
      },
    };
    registerApi(api);
    return () => registerApi(null);
  }, []);

  const insertNewline = (): void => {
    const root = rootRef.current;
    if (root === null) return;
    const sel = flatSelectionOf(root) ?? { start: flatLength(root), end: flatLength(root) };
    const runs = insertAtRuns(runsRef.current, sel.start, '\n');
    runsRef.current = runs;
    renderRuns(root, runs);
    collapseTo(root, sel.start + 1);
  };


  const onBeforeInput = (e: React.FormEvent<HTMLDivElement>): void => {
    const root = rootRef.current;
    if (root === null) return;
    const pending = readPending(root);
    if (Object.keys(pending).length === 0) return;
    const ie = e.nativeEvent as InputEvent;
    if (ie.inputType !== 'insertText') return;
    const data = ie.data;
    if (data === null || data === '') return;
    e.preventDefault();
    const sel = flatSelectionOf(root) ?? { start: flatLength(root), end: flatLength(root) };
    let runs = runsRef.current;
    if (sel.end > sel.start) runs = replaceRangeInRuns(runs, sel.start, sel.end, '');
    runs = insertAtRuns(runs, sel.start, data);
    runs = applyRunModel(runs, sel.start, sel.start + data.length, {
      ...(pending.bold === true ? { bold: true as const } : {}),
      ...(pending.italic === true ? { italic: true as const } : {}),
      ...(pending.underline === true ? { underline: true as const } : {}),
      ...(pending.color !== undefined ? { color: pending.color } : {}),
      ...(pending.fontFamily !== undefined ? { fontFamily: pending.fontFamily } : {}),
      ...(pending.fontSize !== undefined ? { fontSize: pending.fontSize } : {}),
    });
    runsRef.current = runs;
    renderRuns(root, runs);
    collapseTo(root, sel.start + data.length);
    onValueChange?.(runs.map((run) => run.text).join(''));
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    // IME owns the keyboard while composing (Enter confirms the candidate).
    if (composingRef.current) return;
    // Excel: Ctrl/Cmd+B/I/U with characters selected toggles the attribute on
    // the selection and stays in the editor.
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      const key = e.key.toLowerCase();
      if (key === 'b' || key === 'i' || key === 'u') {
        e.preventDefault();
        const attr = key === 'b' ? 'bold' : key === 'i' ? 'italic' : 'underline';
        const root = rootRef.current;
        if (root === null) return;
        const sel = flatSelectionOf(root);
        if (sel !== null && sel.end > sel.start) {
          // Excel toggle: off clears the run override, unless the cell style is
          // bold itself — then an explicit false is needed to win over inherit.
          const turnOff = charsAllHave(runsRef.current, sel.start, sel.end, attr, cellStyle);
          const patchValue = turnOff ? (cellStyle?.[attr] === true ? false : undefined) : true;
          const next = applyRunModel(runsRef.current, sel.start, sel.end, { [attr]: patchValue });
          runsRef.current = next;
          renderRuns(root, next);
          setFlatSelection(root, sel.start, sel.end);
          onValueChange?.(next.map((run) => run.text).join(''));
        } else {
          // Collapsed caret: lock typing style for subsequent input (Excel).
          toggleTypingStyle(root, attr);
          runsRef.current = runsFromDom(root);
        }
        return;
      }
    }
    const arrowDeltas: Record<string, { dr: number; dc: number }> = { ArrowUp: { dr: -1, dc: 0 }, ArrowDown: { dr: 1, dc: 0 }, ArrowLeft: { dr: 0, dc: -1 }, ArrowRight: { dr: 0, dc: 1 } };
    const arrow = arrowDeltas[e.key];
    if (e.key === 'Escape') { e.preventDefault(); cancel(); return; }
    if (e.key === 'F2') { e.preventDefault(); if (!editMode) onUpgradeEditMode?.(); return; }
    if (!editMode && arrow !== undefined && !e.shiftKey && !e.ctrlKey && !e.metaKey) { e.preventDefault(); commit(arrow); return; }
    if (e.key === 'Tab') { e.preventDefault(); commit({ dr: 0, dc: e.shiftKey ? -1 : 1 }); return; }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.altKey) { e.preventDefault(); commit(undefined, true); return; }
    if (e.key === 'Enter' && !e.altKey) { e.preventDefault(); commit({ dr: e.shiftKey ? -1 : 1, dc: 0 }); return; }
    if (e.key === 'Enter' && e.altKey) { e.preventDefault(); insertNewline(); }
  };

  return <div
    ref={rootRef}
    className="ss-editor-overlay ss-editor-overlay--rich"
    contentEditable
    suppressContentEditableWarning
    spellCheck={false}
    role="textbox"
    aria-label={ariaLabel ?? '富文本单元格编辑器'}
    style={css}
    onKeyDown={onKeyDown} onBeforeInput={onBeforeInput}
    onBlur={onBlur}
    onInput={() => {
      if (composingRef.current) return;
      runsRef.current = runsFromDom(rootRef.current);
      onValueChange?.(runsRef.current.map((run) => run.text).join(''));
    }}
    onCompositionStart={() => { composingRef.current = true; }}
    onCompositionEnd={() => {
      composingRef.current = false;
      runsRef.current = runsFromDom(rootRef.current);
      onValueChange?.(runsRef.current.map((run) => run.text).join(''));
    }}
    onPaste={(e) => {
      e.preventDefault();
      const root = rootRef.current;
      if (root === null) return;
      const html = e.clipboardData.getData('text/html');
      const plain = e.clipboardData.getData('text/plain');
      const sel = flatSelectionOf(root) ?? { start: flatLength(root), end: flatLength(root) };
      let inserted: RichTextRun[];
      if (html.trim() !== '') {
        inserted = ClipboardService.runsFromHtmlSnippet(html);
      } else {
        inserted = [{ text: plain.replace(/\r\n/g, '\n') }];
      }
      const insertedText = flattenRuns(inserted);
      let next = replaceRangeInRuns(runsRef.current, sel.start, sel.end, '');
      // Splice runs at caret: delete selection then insert each run with its style.
      let pos = sel.start;
      for (const run of inserted) {
        next = insertAtRuns(next, pos, run.text, run.style);
        pos += run.text.length;
      }
      runsRef.current = mergeRuns(next);
      renderRuns(root, runsRef.current);
      const caret = sel.start + insertedText.length;
      setFlatSelection(root, caret, caret);
      onValueChange?.(flattenRuns(runsRef.current));
    }}
  />;
}

/** One styled span per run; '\n' renders via pre-wrap (kept inside the run text). */
function renderRuns(root: HTMLElement, runs: readonly RichTextRun[]): void {
  root.textContent = '';
  for (const run of runs) {
    const span = document.createElement('span');
    const css = runSpanStyle(run.style ?? {});
    if (css !== '') span.setAttribute('style', css);
    span.textContent = run.text;
    root.appendChild(span);
  }
}

/** Rebuild runs from the DOM tree (spans, semantic tags, text nodes — clipboard semantics). */
function runsFromDom(root: HTMLElement | null): RichTextRun[] {
  if (root === null) return [];
  const out: RichTextRun[] = [];
  const walk = (node: Node, inheritedStyle: Record<string, unknown>): void => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === TEXT_NODE) {
        const text = child.textContent ?? '';
        if (text === '') continue;
        const style = Object.keys(inheritedStyle).length > 0 ? { ...inheritedStyle } as RunStyle : undefined;
        out.push(style !== undefined ? { text, style } : { text });
        continue;
      }
      if (child.nodeType === ELEMENT_NODE) {
        const el = child as HTMLElement;
        if (el.tagName.toLowerCase() === 'br') { out.push({ text: '\n' }); continue; }
        const merged = { ...inheritedStyle, ...(runStyleFromElement(el) as Record<string, unknown>) };
        walk(el, merged);
      }
    }
  };
  walk(root, {});
  return mergeRuns(out);
}

/** Editor-root selection as flat text offsets; null when the selection is elsewhere or collapsed-point missing. */
function flatSelectionOf(root: HTMLElement): { start: number; end: number } | null {
  const sel = typeof window !== 'undefined' ? window.getSelection() : null;
  if (sel === null || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  return {
    start: offsetOfPosition(root, range.startContainer, range.startOffset),
    end: offsetOfPosition(root, range.endContainer, range.endOffset),
  };
}

/** Flat text offset of a DOM position (text-node offset; element offsets snap to the child boundary). */
function offsetOfPosition(root: Node, node: Node, offset: number): number {
  let total = 0;
  let found = false;
  const visit = (n: Node): boolean => {
    if (found) return true;
    if (n === node) {
      if (n.nodeType === TEXT_NODE) total += offset;
      else {
        // Element-level position: sum the text of the children before the anchor child.
        const children = Array.from(n.childNodes).slice(0, offset);
        for (const child of children) total += textLength(child);
      }
      found = true;
      return true;
    }
    if (n.nodeType === TEXT_NODE) { total += n.textContent?.length ?? 0; return false; }
    for (const child of Array.from(n.childNodes)) { if (visit(child)) return true; }
    return false;
  };
  visit(root);
  return total;
}

function textLength(node: Node): number {
  if (node.nodeType === TEXT_NODE) return node.textContent?.length ?? 0;
  let total = 0;
  for (const child of Array.from(node.childNodes)) total += textLength(child);
  return total;
}

/** DOM position for a flat offset; null when past the end (caller collapses to end). */
function positionAtOffset(root: HTMLElement, target: number): { node: Node; offset: number } | null {
  let count = 0;
  const visit = (n: Node): { node: Node; offset: number } | null => {
    if (n.nodeType === TEXT_NODE) {
      const len = n.textContent?.length ?? 0;
      if (target <= count + len) return { node: n, offset: target - count };
      count += len;
      return null;
    }
    for (const child of Array.from(n.childNodes)) {
      const found = visit(child);
      if (found !== null) return found;
    }
    return null;
  };
  return visit(root);
}

function setFlatSelection(root: HTMLElement, start: number, end: number): void {
  const sel = typeof window !== 'undefined' ? window.getSelection() : null;
  if (sel === null) return;
  const startPos = positionAtOffset(root, start);
  const endPos = positionAtOffset(root, end);
  const range = document.createRange();
  if (startPos === null || endPos === null) {
    range.selectNodeContents(root);
    range.collapse(end === 0);
  } else {
    range.setStart(startPos.node, startPos.offset);
    range.setEnd(endPos.node, endPos.offset);
  }
  sel.removeAllRanges();
  sel.addRange(range);
}

function collapseTo(root: HTMLElement, target: number | 'end'): void {
  if (target === 'end') {
    const sel = typeof window !== 'undefined' ? window.getSelection() : null;
    if (sel === null) return;
    const range = document.createRange();
    range.selectNodeContents(root);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
    return;
  }
  setFlatSelection(root, target, target);
}

function flatLength(root: HTMLElement): number {
  return textLength(root);
}

function applyPatchToSelection(root: HTMLElement, patch: RunStylePatch, runsRef: { current: RichTextRun[] }): boolean {
  const sel = flatSelectionOf(root);
  if (sel === null) return false;
  if (sel.end <= sel.start) {
    // Collapsed caret: arm typing style for subsequent input (Excel) — model pending, no execCommand.
    root.focus();
    armTypingPatch(root, patch);
    return true;
  }
  const next = applyRunModel(runsRef.current, sel.start, sel.end, patch);
  runsRef.current = next;
  renderRuns(root, next);
  setFlatSelection(root, sel.start, sel.end);
  return true;
}

/** Pending typing style stored on the editor root (Excel collapsed-caret format). */
type PendingTyping = { bold?: boolean; italic?: boolean; underline?: boolean; color?: string; fontFamily?: string; fontSize?: number };

function readPending(root: HTMLElement): PendingTyping {
  const raw = root.dataset.ssPending;
  if (raw === undefined || raw === '') return {};
  try { return JSON.parse(raw) as PendingTyping; } catch { return {}; }
}

function writePending(root: HTMLElement, pending: PendingTyping): void {
  if (Object.keys(pending).length === 0) delete root.dataset.ssPending;
  else root.dataset.ssPending = JSON.stringify(pending);
}

/** Excel: Ctrl+B with no selection arms bold for the next characters typed — without execCommand. */
function toggleTypingStyle(root: HTMLElement, attr: 'bold' | 'italic' | 'underline'): void {
  root.focus();
  const pending = readPending(root);
  const cur = pending[attr] === true;
  if (cur) delete pending[attr];
  else pending[attr] = true;
  writePending(root, pending);
}

function armTypingPatch(root: HTMLElement, patch: RunStylePatch): void {
  const pending = readPending(root);
  if (patch.bold === true) pending.bold = true;
  else if (patch.bold === false) delete pending.bold;
  if (patch.italic === true) pending.italic = true;
  else if (patch.italic === false) delete pending.italic;
  if (patch.underline === true) pending.underline = true;
  else if (patch.underline === false) delete pending.underline;
  if (typeof patch.color === 'string') pending.color = patch.color;
  if (typeof patch.fontFamily === 'string') pending.fontFamily = patch.fontFamily;
  if (typeof patch.fontSize === 'number') pending.fontSize = patch.fontSize;
  const clean: PendingTyping = {};
  if (pending.bold === true) clean.bold = true;
  if (pending.italic === true) clean.italic = true;
  if (pending.underline === true) clean.underline = true;
  if (pending.color !== undefined) clean.color = pending.color;
  if (pending.fontFamily !== undefined) clean.fontFamily = pending.fontFamily;
  if (pending.fontSize !== undefined) clean.fontSize = pending.fontSize;
  writePending(root, clean);
}


/** Normalized runs for commit: undefined when the draft carries no formatting. */
export function normalizeEditorRuns(runs: readonly RichTextRun[]): RichTextRun[] | undefined {
  return normalizeRuns(runs);
}
