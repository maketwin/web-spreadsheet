import { useEffect, useRef, type CSSProperties, type FC, type KeyboardEvent as ReactKeyboardEvent, type MutableRefObject, type RefObject } from 'react';
import { CanvasRenderer, COL_HEADER_HEIGHT, COL_WIDTH, ROW_HEADER_WIDTH, ROW_HEIGHT, TOTAL_COLS, TOTAL_ROWS, type CellAddress, type FormulaRefHighlight } from '../renderer/CanvasRenderer';
import { useFormulaAssist, parseFormulaRefs, REF_HIGHLIGHT_PALETTE } from './formulaAssist';
import { cycleDollars, endsWithRef, isPointTrigger, refAtCaret, upsertRef } from '../formula/pointMode';
import { caretOffsetFromLocalPoint } from '../util/caretHit';
import { num2alpha } from '../util/alphabet';
import { WRAP_LINE_HEIGHT, wrappedContentHeight } from '../util/wrapText';
import { indentPixels, resolveCellAlign } from '../util/generalAlign';
import { DEFAULT_FONT_SIZE } from '../util/defaults';
import { RichEditor, normalizeEditorRuns, type RichEditorApi } from './RichEditor';
import { flattenRuns, isRich } from '../util/richText';
import type { Store } from '../store/Store';
import type { RichTextRun, Style } from '../types';

export interface EditingCell extends CellAddress { readonly value: string; /** Excel: F2/double-click = edit mode (arrows move the caret); typing = enter mode (arrows commit). */ readonly editMode?: boolean; /** Flat caret offset when opening the editor (double-click hit). */ readonly caret?: number; /** Excel point mode: the cell the formula's trailing reference currently points at. */ readonly point?: CellAddress; /** Mid-edit upgrade: run-level formatting was applied to a selection (forces the rich editor). */ readonly richDraft?: RichTextRun[]; /** Selection to restore in the rich editor after the upgrade. */ readonly richSel?: { readonly start: number; readonly end: number } }

export function clampVal(v: number, min: number, max: number): number { return Math.max(min, Math.min(max, v)); }

interface EditorOverlayProps { readonly refEl: RefObject<HTMLTextAreaElement | null>; readonly editingRefSetter: (cell: EditingCell) => void; readonly editing: EditingCell; readonly setEditing: (cell: EditingCell | null) => void; readonly cancel: () => void; readonly commit: (value: string, moveAfter?: { readonly dr: number; readonly dc: number }, fillSelection?: boolean, runs?: RichTextRun[]) => void; readonly zoom: number; readonly store: Store; readonly cellRect?: { x: number; y: number; w: number; h: number }; readonly richApiRef: MutableRefObject<RichEditorApi | null>; readonly onCharStyleKey?: (key: 'bold' | 'italic' | 'underline') => void; readonly onRefHighlights?: (ranges: readonly FormulaRefHighlight[] | null) => void }
export const EditorOverlay: FC<EditorOverlayProps> = ({ refEl, editingRefSetter, editing, setEditing, cancel, commit, zoom, store, cellRect, richApiRef, onCharStyleKey, onRefHighlights }) => {
  const composing = useRef(false);
  const assist = useFormulaAssist();
  const editingValue = editing.value;
  // Excel formula editing: colored boxes over every range the formula references.
  useEffect(() => {
    if (onRefHighlights === undefined) return;
    if (!editingValue.startsWith('=')) { onRefHighlights(null); return; }
    const refs = parseFormulaRefs(editingValue);
    const ranges = refs.map((r, i) => ({ ...r, color: REF_HIGHLIGHT_PALETTE[i % REF_HIGHLIGHT_PALETTE.length]! }));
    onRefHighlights(ranges.length > 0 ? ranges : null);
  }, [editingValue, onRefHighlights]);
  useEffect(() => () => { onRefHighlights?.(null); }, [onRefHighlights]);
  const cellStyle = store.getCell(editing.r, editing.c)?.styleId !== undefined
    ? store.getStyle(store.getCell(editing.r, editing.c)!.styleId!)
    : undefined;
  const wrapping = cellStyle?.wrap === true || editing.value.includes('\n');
  const cell = store.getCell(editing.r, editing.c);
  const initialRuns = editing.richDraft ?? (isRich(cell?.richText) ? cell!.richText! : undefined);
  if (initialRuns !== undefined) {
    // Excel: rich cells edit in place with per-character styling. The DOM is
    // authoritative while typing; runs for the commit come from the editor api.
    const commitRich = (moveAfter?: { readonly dr: number; readonly dc: number }, fillSelection?: boolean): void => {
      const runs = richApiRef.current?.getRuns() ?? [...initialRuns];
      const normalized = normalizeEditorRuns(runs);
      commit(flattenRuns(runs), moveAfter, fillSelection, normalized ?? undefined);
    };
    return <RichEditor
      initialRuns={initialRuns}
      css={editorStyle(store, editing, zoom, cellRect, cellStyle, editing.value)}
      cellStyle={cellStyle}
      initialSelection={editing.richSel}
      editMode={editing.editMode === true}
      onUpgradeEditMode={() => setEditing({ ...editing, editMode: true })}
      registerApi={(api) => { richApiRef.current = api; }}
      commit={commitRich}
      cancel={cancel}
      onValueChange={(value) => editingRefSetter({ ...editing, value })}
      onBlur={() => {
        // Toolbar/menu interaction keeps the draft alive so formatting can land
        // in the selection; any other blur (click-away) commits like the textarea.
        const active = document.activeElement as HTMLElement | null;
        if (active !== null && active.closest('.ss-interaction-toolbar, .ss-menu-bar, .ss-formula-bar, .ant-dropdown, .ant-popover') !== null) return;
        commitRich();
      }}
    />;
  }
  const editorCss = editorStyle(store, editing, zoom, cellRect, cellStyle, editing.value);
  const assistSetValue = (value: string, caret: number): void => {
    setEditing({ ...editing, value });
    requestAnimationFrame(() => { const t = refEl.current; if (t !== null) { t.selectionStart = caret; t.selectionEnd = caret; } });
  };
  const editorTop = typeof editorCss.top === 'number' ? editorCss.top : 0;
  const editorLeft = typeof editorCss.left === 'number' ? editorCss.left : 0;
  const editorHeight = typeof editorCss.height === 'number' ? editorCss.height : 24;
  return <>
    <textarea
      ref={refEl}
      className={`ss-editor-overlay${wrapping ? ' ss-editor-overlay--wrap' : ''}`}
      style={editorCss}
      value={editing.value}
      rows={1}
      spellCheck={false}
      onChange={(e) => { const v = e.target.value; setEditing({ ...editing, value: v }); assist.afterChange(v, e.target.selectionStart ?? v.length); }}
    onCompositionStart={() => { composing.current = true; }}
    onCompositionEnd={() => { composing.current = false; }}
    onBlur={() => {
      // Same toolbar/menu guard as the rich editor: formatting from the
      // toolbars must land in the draft, not commit it.
      const active = document.activeElement as HTMLElement | null;
      if (active !== null && active.closest('.ss-interaction-toolbar, .ss-menu-bar, .ss-formula-bar, .ant-dropdown, .ant-popover') !== null) return;
      commit(refEl.current?.value ?? editing.value);
    }}
    onKeyDown={(e) => {
      if (composing.current) return;
      // Formula AutoComplete owns the arrow/Tab/Enter keys while its list is open.
      if (assist.onKeyDown(e.key, refEl.current?.value ?? editing.value, refEl.current?.selectionStart ?? editing.value.length, assistSetValue)) {
        e.preventDefault();
        return;
      }
      // Excel: Ctrl/Cmd+B/I/U while editing formats the selected characters
      // (upgrading the draft to rich runs) instead of doing nothing.
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const key = e.key.toLowerCase();
        if (key === 'b' || key === 'i' || key === 'u') {
          e.preventDefault();
          const attr = key === 'b' ? 'bold' : key === 'i' ? 'italic' : 'underline';
          onCharStyleKey?.(attr);
          return;
        }
      }
      // Excel F4: cycle $ anchors on the reference at the caret (A1 → $A$1 → A$1 → $A1).
      if (e.key === 'F4') {
        const el = refEl.current;
        if (el === null) return;
        e.preventDefault();
        const caret = el.selectionStart ?? el.value.length;
        const span = refAtCaret(el.value, caret);
        if (span === undefined) return;
        const cycled = cycleDollars(span.text);
        const next = el.value.slice(0, span.start) + cycled + el.value.slice(span.end);
        setEditing({ ...editing, value: next });
        requestAnimationFrame(() => { el.selectionStart = span.start + cycled.length; el.selectionEnd = span.start + cycled.length; });
        return;
      }
      // Excel point mode: while TYPING a formula that awaits an operand, arrows
      // move the inserted reference instead of committing. In edit mode (F2 /
      // double-click) arrows always move the caret — never insert references.
      const arrowDeltas: Record<string, { dr: number; dc: number }> = { ArrowUp: { dr: -1, dc: 0 }, ArrowDown: { dr: 1, dc: 0 }, ArrowLeft: { dr: 0, dc: -1 }, ArrowRight: { dr: 0, dc: 1 } };
      const arrow = arrowDeltas[e.key];
      if (arrow !== undefined && editing.editMode !== true && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        const el = refEl.current;
        const value = el?.value ?? editing.value;
        const caret = el?.selectionStart ?? value.length;
        const head = value.slice(0, caret);
        if (editing.point !== undefined || isPointTrigger(head)) {
          e.preventDefault();
          const base = editing.point ?? { r: editing.r, c: editing.c };
          const target = { r: clampVal(base.r + arrow.dr, 0, TOTAL_ROWS - 1), c: clampVal(base.c + arrow.dc, 0, TOTAL_COLS - 1) };
          const ref = `${num2alpha(target.c)}${target.r + 1}`;
          const nextHead = upsertRef(head, ref, editing.point !== undefined && endsWithRef(head));
          const nextValue = nextHead + value.slice(el?.selectionEnd ?? caret);
          editingRefSetter({ ...editing, value: nextValue, point: target });
          requestAnimationFrame(() => { const t = refEl.current; if (t !== null) { t.selectionStart = nextHead.length; t.selectionEnd = nextHead.length; } });
          return;
        }
      }
      handleEditorKey(e, refEl, (moveAfter, fillSelection) => commit(refEl.current?.value ?? editing.value, moveAfter, fillSelection), cancel, (next) => setEditing({ ...editing, value: next }), editing.editMode === true, () => setEditing({ ...editing, value: refEl.current?.value ?? editing.value, editMode: true }));
    }}
    aria-label="Cell editor"
    />
    {assist.signature !== null && (
      <div className="ss-formula-signature" style={{ position: 'absolute', left: editorLeft, top: Math.max(0, editorTop - 34), zIndex: 45 }}>
        <span className="ss-sig-name">{assist.signature.name}</span>
        <span className="ss-sig-text">{assist.signature.sig}</span>
        <div className="ss-sig-desc">{assist.signature.desc} · 第 {assist.signature.argIndex + 1} 个参数</div>
      </div>
    )}
    {assist.suggestions !== null && (
      <ul className="ss-formula-assist" style={{ position: 'absolute', left: editorLeft, top: editorTop + editorHeight + 4, zIndex: 45 }}>
        {assist.suggestions.items.map((name, i) => (
          <li
            key={name}
            className={i === assist.suggestions?.active ? 'ss-active' : undefined}
            onMouseDown={(ev) => {
              ev.preventDefault();
              assist.onKeyDown('Enter', refEl.current?.value ?? editing.value, refEl.current?.selectionStart ?? editing.value.length, assistSetValue);
              refEl.current?.focus();
            }}
          >
            <span className="ss-fn-name">{name}</span>
          </li>
        ))}
      </ul>
    )}
  </>;
};

export function handleEditorKey(
  event: ReactKeyboardEvent<HTMLTextAreaElement>,
  refEl: RefObject<HTMLTextAreaElement | null>,
  commit: (moveAfter?: { readonly dr: number; readonly dc: number }, fillSelection?: boolean) => void,
  cancel: () => void,
  setValue: (value: string) => void,
  editMode = false,
  upgradeEditMode?: () => void,
): void {
  if (event.key === 'Escape') { cancel(); return; }
  // Excel: F2 while typing upgrades enter mode → edit mode (arrows then move the caret).
  if (event.key === 'F2') { event.preventDefault(); if (!editMode) upgradeEditMode?.(); return; }
  // Excel "enter mode" (typing): arrows commit and move; F2 edit mode moves the caret.
  // While the text is a formula, arrows stay in the editor (formula entry).
  const arrowDeltas: Record<string, { dr: number; dc: number }> = { ArrowUp: { dr: -1, dc: 0 }, ArrowDown: { dr: 1, dc: 0 }, ArrowLeft: { dr: 0, dc: -1 }, ArrowRight: { dr: 0, dc: 1 } };
  const arrow = arrowDeltas[event.key];
  if (!editMode && arrow !== undefined && !event.shiftKey && !event.ctrlKey && !event.metaKey && refEl.current?.value.startsWith('=') !== true) {
    event.preventDefault();
    commit(arrow);
    return;
  }
  // Excel: Tab commits and moves right (Shift+Tab left)
  if (event.key === 'Tab') { event.preventDefault(); commit({ dr: 0, dc: event.shiftKey ? -1 : 1 }); return; }
  // Excel: Ctrl+Enter commits the typed text into every cell of the selection.
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.altKey) { event.preventDefault(); commit(undefined, true); return; }
  // Excel: Enter commits and moves down (Shift+Enter up); Alt+Enter inserts a line break
  if (event.key === 'Enter' && !event.altKey) { event.preventDefault(); commit({ dr: event.shiftKey ? -1 : 1, dc: 0 }); return; }
  if (event.key === 'Enter' && event.altKey) {
    event.preventDefault();
    const el = refEl.current;
    if (el === null) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const next = `${el.value.slice(0, start)}\n${el.value.slice(end)}`;
    setValue(next);
    requestAnimationFrame(() => {
      const pos = start + 1;
      el.selectionStart = pos;
      el.selectionEnd = pos;
    });
  }
}

/** Approximate Excel double-click caret: hit-test along painted lines (incl. wrap / Alt+Enter). */
export function caretOffsetAtClick(
  renderer: CanvasRenderer | null,
  store: Store,
  cell: CellAddress,
  clientX: number,
  clientY: number,
  zoom: number,
): number {
  // Best-effort caret placement — a transiently inconsistent store (a failed
  // restore mid-swap, a stale HMR tree) must never take the whole React tree
  // down on double-click. Falls back to caret 0 like an empty cell.
  let data: ReturnType<Store['getCell']>;
  try {
    data = store.getCell(cell.r, cell.c);
  } catch {
    return 0;
  }
  const text = data?.formula ?? data?.text ?? '';
  if (text.length === 0 || renderer === null) return 0;
  const rect = renderer.getCellViewportRect(cell.r, cell.c);
  const canvasEl = document.querySelector('canvas.ss-canvas') as HTMLCanvasElement | null;
  if (canvasEl === null) return text.length;
  const bounds = canvasEl.getBoundingClientRect();
  const style = data?.styleId !== undefined ? store.getStyle(data.styleId) : undefined;
  return caretOffsetFromLocalPoint({
    text,
    localX: clientX - bounds.left - rect.x,
    localY: clientY - bounds.top - rect.y,
    cellW: rect.w,
    cellH: rect.h,
    style,
    value: data?.value,
    formula: data?.formula,
    zoom,
    runs: data?.richText,
  });
}

export function editorStyle(
  store: Store,
  cell: CellAddress,
  zoom: number,
  cellRect: { x: number; y: number; w: number; h: number } | undefined,
  style: Style | undefined,
  value: string,
): CSSProperties {
  // Borderless inset 2px so it sits inside the canvas accent strokeRect.
  const inset = 2;
  const scale = zoom / 100;
  const fontSize = Math.max(8, Math.round((style?.fontSize ?? DEFAULT_FONT_SIZE) * scale));
  const fontFamily = style?.fontFamily ?? 'Calibri, "Segoe UI", "Microsoft YaHei", sans-serif';
  const wrapping = style?.wrap === true || value.includes('\n');
  const valign = style?.valign ?? 'middle';
  const editorLineHeight = Math.max(1, Math.round(fontSize * WRAP_LINE_HEIGHT));
  let left: number;
  let top: number;
  let width: number;
  let height: number;
  if (cellRect !== undefined) {
    left = cellRect.x + inset;
    top = cellRect.y + inset;
    width = Math.max(0, cellRect.w - inset * 2);
    height = Math.max(0, cellRect.h - inset * 2);
  } else {
    let x = 0;
    for (let c = 0; c < cell.c; c += 1) x += store.getCol(c)?.width ?? COL_WIDTH;
    let y = 0;
    for (let r = 0; r < cell.r; r += 1) y += store.getRow(r)?.height ?? ROW_HEIGHT;
    const w = store.getCol(cell.c)?.width ?? COL_WIDTH;
    const h = store.getRow(cell.r)?.height ?? ROW_HEIGHT;
    left = ROW_HEADER_WIDTH + x * scale + inset;
    top = COL_HEADER_HEIGHT + y * scale + inset;
    width = Math.max(0, w * scale - inset * 2);
    height = Math.max(0, h * scale - inset * 2);
  }
  const editorContentHeight = wrapping
    ? Math.max(editorLineHeight, wrappedContentHeight(Math.max(1, value.split(/\r?\n/).length), fontSize))
    : editorLineHeight;
  if (wrapping) {
    const lineCount = Math.max(1, value.split(/\r?\n/).length);
    height = Math.max(height, wrappedContentHeight(lineCount, fontSize));
  }
  // Excel: the in-cell editor keeps the cell's indent (left padding for
  // left-aligned text, right padding for right-aligned) instead of the text
  // jumping to the cell edge while editing.
  const editorAlign = resolveCellAlign(style?.align, (() => {
    const live = store.getCell(cell.r, cell.c);
    if (live !== undefined && typeof live.value === 'number') return live.value;
    const n = Number(value);
    return value.trim() !== '' && Number.isFinite(n) && !value.trim().startsWith('=') ? n : value;
  })());
  const indentPx = indentPixels(style, fontSize);
  return {
    left,
    top,
    width,
    height,
    fontSize,
    fontFamily,
    fontWeight: style?.bold === true ? 700 : 400,
    fontStyle: style?.italic === true ? 'italic' : 'normal',
    // Cell-level underline must stay visible inside the editor (spans without
    // an explicit underline override inherit it from here).
    textDecoration: [
      style?.underline === true ? 'underline' : '',
      style?.strike === true ? 'line-through' : '',
    ].filter(Boolean).join(' ') || undefined,
    color: style?.color ?? undefined,
    textAlign: editorAlign,
    lineHeight: `${WRAP_LINE_HEIGHT}`,
    paddingLeft: editorAlign === 'left' ? 3 + indentPx : undefined,
    paddingRight: editorAlign === 'right' ? 3 + indentPx : undefined,
    paddingTop: valign === 'top'
      ? 0
      : valign === 'middle'
        ? Math.max(0, (height - editorContentHeight) / 2)
        : Math.max(0, height - editorContentHeight),
    whiteSpace: wrapping ? 'pre-wrap' : 'nowrap',
    overflow: wrapping ? 'auto' : 'hidden',
    resize: 'none',
  };
}
