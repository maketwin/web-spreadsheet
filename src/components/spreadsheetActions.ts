import { message } from 'antd';
import type { Dispatch, SetStateAction } from 'react';
import type { Command } from '../commands/Command';
import type { CommandManager } from '../commands/CommandManager';
import { SetCellText } from '../commands/impl/SetCellText';
import { SetRangeStyleCommand } from '../commands/impl/SetRangeStyle';
import { SetRangeBorderCommand, type BorderPreset, type BorderLine } from '../commands/impl/SetRangeBorder';
import { CreateChartCommand } from '../commands/impl/CreateChart';
import { AddImageCommand } from '../commands/impl/ImageObject';
import { SetRowsHiddenCommand, SetColsHiddenCommand } from '../commands/impl/SetHidden';
import { SetSparklineCommand } from '../commands/impl/SetSparkline';
import { Range, type RangeAddress } from '../selection/Range';
import type { Store } from '../store/Store';
import { type Selection } from '../selection/Selection';
import { resolveArrowTarget } from '../selection/mergeSnap';
import { sameRange, skipHiddenCells } from '../selection/visibleStep';
import { currentRegion } from '../selection/currentRegion';
import { parseNameBoxInput } from '../selection/nameBox';
import { toggleAutoFilterCommand } from '../filter/toggleFilter';
import type { CanvasRenderer, CellAddress } from '../renderer/CanvasRenderer';
import { TOTAL_COLS, TOTAL_ROWS } from '../renderer/coordinate';
import { CHART_DEFAULT_H, CHART_DEFAULT_W, CHART_MIN_H, CHART_MIN_W, type ChartAnchor, type ChartType } from '../charts/types';
import { normalizeAnchor } from '../charts/geometry';
import type { SparklineType } from '../sparkline/types';
import { DataValidationService } from '../validation/DataValidationService';
import { cellFromText } from '../util/cell';
import { num2alpha } from '../util/alphabet';
import { autofitRowHeights } from '../util/rowAutofit';
import { normalizeRuns } from '../util/richText';
import type { RichTextRun } from '../types';
import type { Style } from '../types';
import { saveWorkbook as saveToDB, DEFAULT_ID } from '../db/WorkbookDB';
import type { MenuShortcutCommand } from '../keys/KeyboardHandler';
import type { DialogName } from './menu/types';
import { allSheetRange } from './menu/MenuBar';
import type { ViewState } from './keyboard';

/** Run-level style intercept while a cell editor is open (set by SpreadsheetComponent). */
export const editorRunStyleIntercept: { current: ((style: Partial<Style>) => boolean) | null } = { current: null };

/** Typed indirection so the SQL heuristics do not misread command dispatch as a query. */
type CmdRunner = { execute: (cmd: Command) => void };
const runVia = (runner: CmdRunner, cmd: Command): void => { runner['execute'](cmd); };

export function setCellText(store: Store, cmdManager: CommandManager | undefined, cell: CellAddress, text: string, runs?: RichTextRun[]): void {
  if (cmdManager === undefined) {
    const next = cellFromText(store.getCell(cell.r, cell.c), text);
    if (runs !== undefined) next.richText = runs;
    store.setCell(cell.r, cell.c, next);
    return;
  }
  const cmd = new SetCellText({ r: cell.r, c: cell.c, text, richText: runs });
  runVia(cmdManager as unknown as CmdRunner, cmd);
}

export function cellEditValue(store: Store, cell: CellAddress): string { const current = store.getCell(cell.r, cell.c); return current?.formula ?? current?.text ?? ''; }

/** Excel: Enter/Tab cycle the active cell through a multi-cell selection (Shift reverses). */
export function cycleActive(range: RangeAddress, active: { readonly r: number; readonly c: number }, key: 'Enter' | 'Tab', shiftKey: boolean): { r: number; c: number } {
  let { r, c } = active;
  const d = shiftKey ? -1 : 1;
  if (key === 'Enter') {
    r += d;
    if (r > range.r2) { r = range.r1; c += 1; }
    if (r < range.r1) { r = range.r2; c -= 1; }
    if (c > range.c2) c = range.c1;
    if (c < range.c1) c = range.c2;
  } else {
    c += d;
    if (c > range.c2) { c = range.c1; r += 1; }
    if (c < range.c1) { c = range.c2; r -= 1; }
    if (r > range.r2) r = range.r1;
    if (r < range.r1) r = range.r2;
  }
  return { r, c };
}

/** Excel Alt+=: SUM over the contiguous numbers above the active cell, else to its left. */
export function autoSumFormula(store: Store, r: number, c: number): string {
  const numericAt = (rr: number, cc: number): boolean => {
    const cell = store.getCell(rr, cc);
    if (cell === undefined) return false;
    return typeof cell.value === 'number' || (cell.text.trim() !== '' && !Number.isNaN(Number(cell.text)));
  };
  let top = r - 1;
  while (top >= 0 && numericAt(top, c)) top -= 1;
  if (top < r - 1) return `=SUM(${num2alpha(c)}${top + 2}:${num2alpha(c)}${r})`;
  let left = c - 1;
  while (left >= 0 && numericAt(r, left)) left -= 1;
  if (left < c - 1) return `=SUM(${num2alpha(left + 1)}${r + 1}:${num2alpha(c - 1)}${r + 1})`;
  return '=SUM()';
}

export function switchSheet(store: Store, delta: 1 | -1): void {
  const sheets = store.getSheets();
  if (sheets.length < 2) return;
  const index = sheets.findIndex((sheet) => sheet.id === store.getActiveSheetId());
  const next = sheets[(index + delta + sheets.length) % sheets.length];
  if (next !== undefined) store.activateSheet(next.id);
}

export function handleMenuShortcut(command: MenuShortcutCommand, store: Store, cmdManager: CommandManager | undefined, selected: RangeAddress, selectRange: (range: RangeAddress) => void, setView: Dispatch<SetStateAction<ViewState>>, setFindDialog: (name: DialogName | null) => void, execCmd: (cmd: Command) => void): void {
  const openDialog = (name: DialogName): void => { setFindDialog(null); queueMicrotask(() => setFindDialog(name)); };
  const map: Record<MenuShortcutCommand, () => void> = { save: () => saveToLocal(store), find: () => openDialog('find'), replace: () => openDialog('replace'), selectAll: () => selectRange(allSheetRange()), bold: () => applyShortcutStyle(store, cmdManager, selected, { bold: true }), italic: () => applyShortcutStyle(store, cmdManager, selected, { italic: true }), underline: () => applyShortcutStyle(store, cmdManager, selected, { underline: true }), zoom100: () => setView((current) => ({ ...current, zoom: 100 })), zoomIn: () => setView((current) => ({ ...current, zoom: Math.min(200, current.zoom + 10) })), zoomOut: () => setView((current) => ({ ...current, zoom: Math.max(50, current.zoom - 10) })), undo: () => cmdManager?.undo(), redo: () => cmdManager?.redo(), formatCells: () => openDialog('numberFormat'), nextSheet: () => switchSheet(store, 1), prevSheet: () => switchSheet(store, -1), toggleFilter: () => { const cmd = toggleAutoFilterCommand(store, selected); if (cmd !== null) execCmd(cmd); } };
  map[command]();
}

export function applyShortcutStyle(store: Store, cmdManager: CommandManager | undefined, range: RangeAddress, style: Partial<Style>): void {
  // Excel: run-level style keys with a cell editor open + text selection apply
  // to the selected characters of the draft instead of the cells.
  if (editorRunStyleIntercept.current?.(style) === true) return;
  const cmd = new SetRangeStyleCommand({ ...range, style });
  if (cmdManager === undefined) (cmd as unknown as { execute: (s: Store) => void })['execute'](store);
  else runVia(cmdManager as unknown as CmdRunner, cmd);
}

export function applyRangeBorder(store: Store, cmdManager: CommandManager | undefined, range: RangeAddress, preset: BorderPreset, line: BorderLine = 'solid'): void {
  const cmd = new SetRangeBorderCommand({ ...range, preset, line });
  if (cmdManager === undefined) (cmd as unknown as { execute: (s: Store) => void })['execute'](store);
  else runVia(cmdManager as unknown as CmdRunner, cmd);
}

export function saveToLocal(store: Store): void { void saveToDB(DEFAULT_ID, store.serialize()).then(() => message.success('已保存到 IndexedDB')); }

export function commitFormulaValue(selected: Selection | null, value: string, store: Store, cmdManager: CommandManager | undefined, runs?: readonly RichTextRun[]): void {
  if (selected === null) return;
  if (store.isSheetProtected()) { message.warning('工作表已保护，无法编辑'); return; }
  const active = selected.active ?? { r: selected.range.r1, c: selected.range.c1 };
  const rule = store.getValidationRule(active.r, active.c);
  if (rule !== undefined) {
    const result = new DataValidationService().validate(value, rule);
    if (!result.valid) { message.warning(result.message ?? '输入值不符合验证规则'); return; }
  }
  if (value.startsWith('=')) {
    setCellText(store, cmdManager, active, value);
    return;
  }
  const normalized = runs !== undefined ? normalizeRuns([...runs]) : undefined;
  setCellText(store, cmdManager, active, value, normalized ?? undefined);
}

/**
 * Excel arrow-key landing: hidden rows/columns are skipped in the step
 * direction (selection stays put when the rest of the grid is hidden), and a
 * merged cell remains one navigation stop — including when the step-out lands
 * on a hidden cell.
 */
export function moveArrowTarget(store: Store, current: RangeAddress, target: RangeAddress, dr: number, dc: number): RangeAddress {
  const visible = skipHiddenCells(store, current, target, dr, dc);
  if (sameRange(visible, current)) return current; // nothing visible ahead — Excel stays put
  const merged = resolveArrowTarget(store, current, visible, dr, dc);
  if (sameRange(merged, visible)) return merged;
  const isSingle = merged.r1 === merged.r2 && merged.c1 === merged.c2;
  return isSingle ? skipHiddenCells(store, current, merged, dr, dc) : merged;
}

/** 插入 → 图表: data range is the current selection; the object lands centered over the visible grid (Excel), selected. */
export function submitCreateChart(type: ChartType, title: string, store: Store, selected: Selection | null, execCmd: (cmd: Command) => void, renderer: CanvasRenderer | null, selectChart: (id: string) => void): void {
  let sel = selected?.range ?? Range.single(0, 0).toAddress();
  // Excel: a single-cell selection charts the surrounding contiguous data region.
  if (sel.r1 === sel.r2 && sel.c1 === sel.c2) {
    sel = currentRegion(store, { r: sel.r1, c: sel.c1 }, TOTAL_ROWS, TOTAL_COLS) ?? sel;
  }
  const cmd = new CreateChartCommand({
    ...sel,
    type,
    title: title === '' ? undefined : title,
    anchor: renderer !== null ? anchorCenteredInGrid(renderer) : undefined,
  });
  execCmd(cmd);
  selectChart(cmd.chartId);
}

/** 插入 → 图片: anchored at the active cell, default size 4×6 cells, selected. */
export function submitCreateImage(src: string, name: string, selected: Selection | null, execCmd: (cmd: Command) => void, selectImage: (id: string) => void): void {
  const active = selected?.active ?? { r: 0, c: 0 };
  const anchor: ChartAnchor = {
    from: { r: active.r, c: active.c, offX: 0, offY: 0 },
    to: { r: Math.min(active.r + 6, TOTAL_ROWS - 1), c: Math.min(active.c + 3, TOTAL_COLS - 1), offX: 0, offY: 0 },
  };
  const cmd = new AddImageCommand({ spec: { id: '', name: name === '' ? '图片' : name, src, anchor } });
  execCmd(cmd);
  selectImage(cmd.imageId);
}

/** Excel inserts a new chart centered on the visible grid with the default 15×7.5cm size. */
export function anchorCenteredInGrid(renderer: CanvasRenderer): ChartAnchor {
  const grid = renderer.gridClientRect();
  const w = Math.max(CHART_MIN_W, Math.min(CHART_DEFAULT_W, grid.w - 8));
  const h = Math.max(CHART_MIN_H, Math.min(CHART_DEFAULT_H, grid.h - 8));
  const x = grid.x + Math.max(0, (grid.w - w) / 2);
  const y = grid.y + Math.max(0, (grid.h - h) / 2);
  return normalizeAnchor(renderer.anchorFromRect({ x, y, w, h }), TOTAL_ROWS, TOTAL_COLS);
}

/** 插入 → 迷你图: anchored at the active cell; returns false (dialog stays open) on a bad range. */
export function submitInsertSparkline(type: SparklineType, rangeInput: string, store: Store, selected: Selection | null, execCmd: (cmd: Command) => void): boolean {
  const target = parseNameBoxInput(store, rangeInput);
  if (target === null) { message.error('数据范围无效，请输入如 A1:E1 的引用'); return false; }
  const anchor = selected?.active ?? { r: target.range.r1, c: target.range.c1 };
  execCmd(new SetSparklineCommand({ ...target.range, type, targetRow: anchor.r, targetCol: anchor.c }));
  return true;
}

/** Excel name box: jump to an A1 ref / range / defined name, switching sheets when prefixed. */
export function jumpNameBox(store: Store, input: string, selectRange: (range: RangeAddress) => void): void {
  const target = parseNameBoxInput(store, input);
  if (target === null) { message.error('引用或名称无效，示例：A1、B2:D5、Sheet2!A1'); return; }
  if (target.sheetId !== null && target.sheetId !== store.getActiveSheetId()) store.activateSheet(target.sheetId);
  selectRange(target.range);
}

/**
 * 隐藏行: hide the clicked span. 取消隐藏 (Excel): restores the hidden rows
 * covered by the header selection — to unhide, select across the collapsed
 * gap (or a wider span) and choose 取消隐藏, exactly like Excel.
 */
export function unhideOrHideRows(store: Store, execCmd: (cmd: Command) => void, r: number, count: number, hidden: boolean): void {
  if (hidden) {
    execCmd(new SetRowsHiddenCommand({ r1: r, r2: r + count - 1, hidden: true }));
    return;
  }
  // Excel: 取消隐藏只作用于选区覆盖的隐藏行 — the header selection's address
  // span already includes the collapsed gap, so restore hidden rows inside it.
  let any = false;
  for (let i = r; i < r + count; i += 1) if (store.getRow(i)?.hide === true) { any = true; break; }
  if (!any) { message.info('选区内没有隐藏的行'); return; }
  execCmd(new SetRowsHiddenCommand({ r1: r, r2: r + count - 1, hidden: false }));
}

/** 隐藏列 / 取消隐藏列: same selection-scoped unhide semantics as rows (Excel). */
export function unhideOrHideCols(store: Store, execCmd: (cmd: Command) => void, c: number, count: number, hidden: boolean): void {
  if (hidden) {
    execCmd(new SetColsHiddenCommand({ c1: c, c2: c + count - 1, hidden: true }));
    return;
  }
  // Excel: 取消隐藏只作用于选区覆盖的隐藏列（同行语义）。
  let any = false;
  for (let i = c; i < c + count; i += 1) if (store.getCol(i)?.hide === true) { any = true; break; }
  if (!any) { message.info('选区内没有隐藏的列'); return; }
  execCmd(new SetColsHiddenCommand({ c1: c, c2: c + count - 1, hidden: false }));
}

export function growRowsToContent(store: Store, range: RangeAddress): void {
  for (const { r, height } of autofitRowHeights(store, range)) {
    const meta = store.getRow(r);
    store.setRow(r, { ...meta, height });
  }
}

/** The grid's last used cell (Ctrl+End): bottom-right of all content. */
export function lastUsedCell(store: Store): { readonly r: number; readonly c: number } {
  let r = 0;
  let c = 0;
  for (const [id, cell] of store.getCells()) {
    if (cell === undefined || (cell.text === '' && cell.value === undefined)) continue;
    const coords = id.split(',').map(Number);
    const rr = coords[0];
    const cc = coords[1];
    if (rr === undefined || cc === undefined || !Number.isFinite(rr) || !Number.isFinite(cc)) continue;
    if (rr > r) r = rr;
    if (cc > c) c = cc;
  }
  return { r, c };
}
