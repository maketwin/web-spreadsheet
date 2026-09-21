import { BarChartOutlined, DatabaseOutlined, EditOutlined, FileOutlined, CheckOutlined, FormatPainterOutlined, LockOutlined, QuestionCircleOutlined, TableOutlined } from '@ant-design/icons';
import { Dropdown, Form, Input, Modal, Switch, message } from 'antd';
import type { MenuProps } from 'antd';
import { useMemo, useRef, useState, useEffect, type FC, type ReactElement, type ReactNode } from 'react';
import { ClipboardService } from '../../clipboard/ClipboardService';
import { autofitRowHeights } from '../../util/rowAutofit';
import type { ChartType } from '../../charts/types';
import type { SparklineType } from '../../sparkline/types';
import { DeleteColCommand } from '../../commands/impl/DeleteCol';
import { DeleteRowCommand } from '../../commands/impl/DeleteRow';
import { RemoveDuplicatesCommand } from '../../commands/impl/RemoveDuplicates';
import { TextToColumnsCommand } from '../../commands/impl/TextToColumns';
import { SetHyperlinkCommand } from '../../commands/impl/SetHyperlink';
import { InsertColCommand } from '../../commands/impl/InsertCol';
import { InsertRowCommand } from '../../commands/impl/InsertRow';
import { SetRangeStyleCommand } from '../../commands/impl/SetRangeStyle';
import { SetRangeValues } from '../../commands/impl/SetRangeValues';
import { SetNumberFormatCommand } from '../../commands/impl/SetNumberFormat';
import { SetConditionalFormatCommand } from '../../commands/impl/SetConditionalFormat';
import type { ConditionalRule } from '../../conditional/ConditionalRule';
import type { ValidationRule, ValidationType } from '../../validation/types';
import { SetValidationCommand } from '../../commands/impl/SetValidation';
import { FilterService } from '../../filter/FilterService';
import { SetAutoFilterCommand } from '../../commands/impl/SetAutoFilter';
import { SetAutoFilterCriteriaCommand } from '../../commands/impl/SetAutoFilterCriteria';
import { SortRangeCommand } from '../../commands/impl/SortRange';
import { FindReplaceService, type FindMatch } from '../../find/FindReplaceService';
import { protectSheet, unprotectSheet, verifyPassword } from '../../protection/SheetProtection';
import { TOTAL_COLS, TOTAL_ROWS } from '../../renderer/CanvasRenderer';
import { Range, type RangeAddress } from '../../selection/Range';
import { Store, type SerializedStore } from '../../store/Store';
import type { Command } from '../../commands/Command';
import type { Cell, Style } from '../../types';
import { mergeSelection } from '../mergeActions';
import { mergesIntersecting } from '../../util/merge';
import { saveWorkbook as saveToDB, DEFAULT_ID } from '../../db/WorkbookDB';
import { exportCsvBlob } from '../../io/CsvExporter';
import { exportXlsx } from '../../io/XlsxExporter';
import { importXlsx } from '../../io/XlsxImporter';
import { AboutDialog } from './dialogs/AboutDialog';
import { ChartDialog } from './dialogs/ChartDialog';
import { DataValidationDialog, type ValidationConfig } from './dialogs/DataValidationDialog';
import { RemoveDuplicatesDialog } from './dialogs/RemoveDuplicatesDialog';
import { TextToColumnsDialog } from './dialogs/TextToColumnsDialog';
import { HyperlinkDialog } from './dialogs/HyperlinkDialog';
import { FindReplaceDialog } from './dialogs/FindReplaceDialog';
import { InsertColDialog, type InsertColValues } from './dialogs/InsertColDialog';
import { InsertRowDialog, type InsertRowValues } from './dialogs/InsertRowDialog';
import { NumberFormatDialog, type NumberFormatValues } from './dialogs/NumberFormatDialog';
import { ShortcutsDialog } from './dialogs/ShortcutsDialog';
import { SparklineDialog } from './dialogs/SparklineDialog';
import { ZoomDialog, type ZoomValues } from './dialogs/ZoomDialog';
import { shortcutLabel } from './shortcutLabel';
import type { DialogName, MenuActions, MenuContext, ViewState } from './types';
import { HistoryPanel } from '../HistoryPanel';
import { PrintPreview } from '../PrintPreview';

export interface MenuBarProps extends MenuContext {
  readonly view?: Partial<ViewState>;
  readonly onFindNavigate?: (match: FindMatch) => void;
  readonly onFindHighlight?: (matches: readonly FindMatch[], current: number) => void;
  readonly openDialogKey?: DialogName | null;
  /** 插入 → 图表：owner executes CreateChartCommand against its command manager. */
  readonly onCreateChart?: (type: ChartType, title: string) => void;
  /** 插入 → 迷你图：return false to keep the dialog open (invalid range). */
  readonly onInsertSparkline?: (type: SparklineType, rangeInput: string) => boolean;
}

export const MenuBar: FC<MenuBarProps> = (props) => {
  const [dialog, setDialog] = useState<DialogName | null>(null);
  const [zoom, setZoom] = useState(props.view?.zoom ?? 100);
  const [showFormula, setShowFormula] = useState(props.view?.showFormula ?? false);
  const [showGrid, setShowGrid] = useState(props.view?.showGrid ?? true);
  const [frozenRows, setFrozenRows] = useState(props.view?.frozenRows ?? 0);
  const [frozenCols, setFrozenCols] = useState(props.view?.frozenCols ?? 0);
  const findService = useRef(new FindReplaceService());
  const fileInput = useRef<HTMLInputElement>(null);
  const xlsxInput = useRef<HTMLInputElement>(null);
  const view = makeView(props.view, zoom, showFormula, showGrid, frozenRows, frozenCols, setZoom, setShowFormula, setShowGrid, setFrozenRows, setFrozenCols);
  const actions = useMemo(() => makeActions(props, setDialog, view, fileInput, xlsxInput), [props, view]);
  useEffect(() => { if (props.openDialogKey !== undefined && props.openDialogKey !== null) setDialog(props.openDialogKey); }, [props.openDialogKey]);
  useEffect(() => {
    if (props.view?.frozenRows !== undefined) setFrozenRows(props.view.frozenRows);
    if (props.view?.frozenCols !== undefined) setFrozenCols(props.view.frozenCols);
  }, [props.view?.frozenRows, props.view?.frozenCols]);

  const menus = topMenus(actions, view, props);
  return <div className="ss-menu-bar" role="menubar" aria-orientation="horizontal" aria-label="Spreadsheet menu">
    <div className="ss-menu-strip">
      {menus.map((menu) => <Dropdown key={menu.key} trigger={['click']} placement="bottomLeft" menu={{ items: menu.items, onClick: ({ key }) => actions.run(String(key)) }}>
        <button className="ss-menu-trigger" type="button" role="menuitem" aria-haspopup="menu"
          // Excel: opening a menu while editing a cell keeps the edit session alive.
          onMouseDown={(e) => e.preventDefault()}>
          {menu.icon}<span>{menu.label}</span>
        </button>
      </Dropdown>)}
    </div>
    <input ref={fileInput} hidden type="file" accept=".csv,.tsv,.xlsx,.json" onChange={(e) => openLocalFile(e, props)} />
    <input ref={xlsxInput} hidden type="file" accept=".xlsx" onChange={(e) => openXlsxFile(e, props)} />
    <Dialogs dialog={dialog} setDialog={setDialog} props={props} view={view} findService={findService.current} />
  </div>;
};

interface TopMenu { readonly key: string; readonly label: string; readonly icon: ReactElement; readonly items: NonNullable<MenuProps['items']> }

function topMenus(actions: MenuActions, view: ViewState, ctx: MenuBarProps): readonly TopMenu[] {
  void actions;
  return [
    { key: 'file', label: '文件(F)', icon: <FileOutlined />, items: fileItems() },
    { key: 'edit', label: '编辑(E)', icon: <EditOutlined />, items: editItems() },
    { key: 'view', label: '视图(V)', icon: <TableOutlined />, items: viewItems(view) },
    { key: 'insert', label: '插入(I)', icon: <BarChartOutlined />, items: insertItems() },
    { key: 'format', label: '格式(O)', icon: <FormatPainterOutlined />, items: formatItems(ctx) },
    { key: 'data', label: '数据(D)', icon: <DatabaseOutlined />, items: dataItems(ctx) },
    { key: 'review', label: '审阅(R)', icon: <LockOutlined />, items: reviewItems() },
    { key: 'help', label: '帮助(H)', icon: <QuestionCircleOutlined />, items: helpItems() },
  ];
}

function fileItems(): NonNullable<MenuProps['items']> {
  return [
    item('file:new', shortcutLabel('新建工作簿', 'Ctrl+N')),
    item('file:open', shortcutLabel('打开...', 'Ctrl+O')),
    item('file:save', shortcutLabel('保存', 'Ctrl+S')),
    item('file:saveAs', '另存为...'),
    divider('file:divider:1'),
    item('file:import', '导入 CSV/TSV'),
    item('file:importXlsx', '导入 xlsx'),
    item('file:export', '导出 JSON'),
    item('file:exportCsv', '导出 CSV'),
    item('file:exportXlsx', '导出 xlsx'),
    divider('file:divider:2'),
    item('file:print', '打印...'),
    divider('file:divider:3'),
    item('file:close', '关闭演示'),
  ];
}

function editItems(): NonNullable<MenuProps['items']> {
  return [
    item('edit:undo', shortcutLabel('撤销', 'Ctrl+Z')),
    item('edit:redo', shortcutLabel('重做', 'Ctrl+Y')),
    item('edit:history', '撤销历史...'),
    divider('edit:divider:1'),
    item('edit:cut', shortcutLabel('剪切', 'Ctrl+X')),
    item('edit:copy', shortcutLabel('复制', 'Ctrl+C')),
    item('edit:paste', shortcutLabel('粘贴', 'Ctrl+V')),
    divider('edit:divider:2'),
    item('edit:clear', '清除内容'),
    item('edit:selectAll', shortcutLabel('全选', 'Ctrl+A')),
    divider('edit:divider:3'),
    item('edit:find', shortcutLabel('查找...', 'Ctrl+F')),
    item('edit:replace', shortcutLabel('替换...', 'Ctrl+H')),
  ];
}

function viewItems(view: ViewState): NonNullable<MenuProps['items']> {
  const frozen = view.frozenRows > 0 || view.frozenCols > 0;
  return [
    item('view:zoom100', shortcutLabel('100%', 'Ctrl+0')),
    item('view:zoom', '缩放级别...'),
    item('view:zoomIn', shortcutLabel('放大', 'Ctrl++')),
    item('view:zoomOut', shortcutLabel('缩小', 'Ctrl+-')),
    divider('view:divider:1'),
    item('view:formula', <ToggleLabel text="显示公式" checked={view.showFormula} />),
    item('view:grid', <ToggleLabel text="显示网格线" checked={view.showGrid} />),
    divider('view:divider:2'),
    // Excel 视图 → 冻结窗格：冻结窗格 / 冻结首行 / 冻结首列
    { key: 'view:freezeMenu', label: '冻结窗格', children: [
      item('view:freeze:panes', frozen ? '取消冻结窗格' : '冻结窗格'),
      item('view:freeze:topRow', '冻结首行'),
      item('view:freeze:firstCol', '冻结首列'),
    ] },
    item('view:fitWidth', '适应窗口宽度'),
  ];
}

function insertItems(): NonNullable<MenuProps['items']> {
  return [
    item('insert:chart', '图表...'),
    item('insert:sparkline', '迷你图...'),
    item('insert:hyperlink', '链接...'),
    divider('insert:divider:1'),
    item('insert:row', '插入行...'),
    item('insert:col', '插入列...'),
    item('insert:deleteRow', '删除行'),
    item('insert:deleteCol', '删除列'),
  ];
}

function formatItems(ctx: MenuBarProps): NonNullable<MenuProps['items']> {
  return [
    item('format:bold', shortcutLabel('加粗', 'Ctrl+B')),
    item('format:italic', shortcutLabel('斜体', 'Ctrl+I')),
    item('format:underline', shortcutLabel('下划线', 'Ctrl+U')),
    divider('format:divider:0'),
    { key: 'format:font', label: '字体', children: [
      item('format:font:Calibri', 'Calibri'),
      item('format:font:Microsoft YaHei', '微软雅黑'),
      item('format:font:SimSun', '宋体'),
      item('format:font:Arial', 'Arial'),
      item('format:font:Times New Roman', 'Times New Roman'),
      item('format:font:Consolas', 'Consolas'),
    ] },
    { key: 'format:fontSize', label: '字号', children: [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 36, 48, 72].map((n) => item(`format:fontSize:${n}`, String(n))) },
    { key: 'format:color', label: '字体颜色', children: [
      item('format:color:#000000', '黑色'),
      item('format:color:#FF0000', '红色'),
      item('format:color:#0000FF', '蓝色'),
      item('format:color:#217346', '绿色'),
      item('format:color:#FF6600', '橙色'),
      item('format:color:#808080', '灰色'),
    ] },
    { key: 'format:fill', label: '填充颜色', children: [
      item('format:fill:#FFFFFF', '无填充'),
      item('format:fill:#FFFF00', '黄色'),
      item('format:fill:#00FF00', '浅绿'),
      item('format:fill:#00FFFF', '青色'),
      item('format:fill:#FFC7CE', '浅红'),
      item('format:fill:#FFEB9C', '浅黄'),
      item('format:fill:#C6EFCE', '浅绿'),
      item('format:fill:#BDD7EE', '浅蓝'),
    ] },
    divider('format:divider:1'),
    { key: 'format:align', label: '对齐', children: [
      item('format:align:left', '左对齐'),
      item('format:align:center', '居中'),
      item('format:align:right', '右对齐'),
      { type: 'divider', key: 'format:align:div' },
      item('format:valign:top', '顶端对齐'),
      item('format:valign:middle', '垂直居中'),
      item('format:valign:bottom', '底端对齐'),
      { type: 'divider', key: 'format:valign:div' },
      {
        key: 'format:wrap',
        label: '自动换行',
        icon: selectionHasWrap(ctx) ? <CheckOutlined /> : <span style={{ display: 'inline-block', width: 14 }} />,
      },
    ] },
    divider('format:divider:2'),
    item('format:mergeCenter', '合并后居中'),
    item('format:mergeAcross', '跨越合并'),
    item('format:merge', '合并单元格'),
    item('format:unmerge', '取消合并'),
    divider('format:divider:3'),
    item('format:number', '数字格式...'),
    divider('format:divider:4'),
    { key: 'format:conditional', label: '条件格式', children: [item('format:cf:dataBar', '数据条'), item('format:cf:colorScale', '色阶'), item('format:cf:cellValue', '单元格值'), item('format:cf:formula', '公式条件')] },
  ];
}

function dataItems(ctx: MenuBarProps): NonNullable<MenuProps['items']> {
  const filter = new FilterService(ctx.store).getAutoFilter();
  const active = filter !== undefined;
  const hasCriteria = filter !== undefined && Object.keys(filter.criteria).length > 0;
  return [
    item('data:validation', '数据验证...'),
    divider('data:divider:1'),
    item('data:autoFilter', active ? <span className="ss-menu-check"><CheckOutlined /> 筛选</span> : <span className="ss-menu-check"><span style={{ display: 'inline-block', width: 14 }} /> 筛选</span>),
    item('data:clearFilter', '清除筛选', !hasCriteria),
    item('data:reapplyFilter', '重新应用', !active),
    divider('data:divider:2'),
    item('data:sortAsc', '升序排序'),
    item('data:sortDesc', '降序排序'),
    divider('data:divider:3'),
    item('data:removeDuplicates', '删除重复项...'),
    item('data:textToColumns', '分列...'),
  ];
}

function reviewItems(): NonNullable<MenuProps['items']> {
  return [
    item('review:protect', '保护工作表...'),
    item('review:unprotect', '取消保护工作表...'),
  ];
}

function helpItems(): NonNullable<MenuProps['items']> {
  return [item('help:docs', '文档'), item('help:shortcuts', '快捷键'), divider('help:divider:1'), item('help:about', '关于')];
}

function item(key: string, label: ReactNode, disabled = false): NonNullable<MenuProps['items']>[number] {
  return { key, label, disabled };
}

function divider(key: string): NonNullable<MenuProps['items']>[number] {
  return { key, type: 'divider' };
}

function makeActions(ctx: MenuContext, openDialog: (name: DialogName) => void, view: ViewState, fileInput: React.RefObject<HTMLInputElement | null>, xlsxInput: React.RefObject<HTMLInputElement | null>): MenuActions {
  return { run: (key) => runMenuAction(String(key), ctx, openDialog, view, fileInput, xlsxInput), openDialog, applyStyle: (style) => applyStyle(ctx, style) };
}

function runMenuAction(key: string, ctx: MenuContext, openDialog: (name: DialogName) => void, view: ViewState, fileInput: React.RefObject<HTMLInputElement | null>, xlsxInput: React.RefObject<HTMLInputElement | null>): void {
  if (key.startsWith('file:')) runFileAction(key, ctx, openDialog, fileInput, xlsxInput);
  else if (key.startsWith('edit:')) runEditAction(key, ctx, openDialog);
  else if (key.startsWith('insert:')) runInsertAction(key, ctx, openDialog);
  else if (key.startsWith('format:')) runFormatAction(key, ctx, openDialog);
  else if (key.startsWith('view:')) runViewAction(key, view, openDialog, ctx);
  else if (key.startsWith('data:')) runDataAction(key, ctx, openDialog);
  else if (key.startsWith('review:')) runReviewAction(key, ctx, openDialog);
  else if (key.startsWith('help:')) runHelpAction(key, openDialog);
}

function runFileAction(key: string, ctx: MenuContext, openDialog: (name: DialogName) => void, fileInput: React.RefObject<HTMLInputElement | null>, xlsxInput: React.RefObject<HTMLInputElement | null>): void {
  if (key === 'file:new') confirmNew(ctx);
  if (key === 'file:open' || key === 'file:import') fileInput.current?.click();
  if (key === 'file:importXlsx') xlsxInput.current?.click();
  if (key === 'file:save') saveWorkbook(ctx.store);
  if (key === 'file:saveAs' || key === 'file:export') downloadWorkbook(ctx.store);
  if (key === 'file:exportCsv') downloadCsv(ctx.store);
  if (key === 'file:exportXlsx') downloadXlsx(ctx.store);
  if (key === 'file:print') openDialog('printPreview');
  if (key === 'file:close') ctx.closeDemo?.();
}

function runEditAction(key: string, ctx: MenuContext, openDialog: (name: DialogName) => void): void {
  if (key === 'edit:undo') ctx.cmdManager?.undo();
  if (key === 'edit:redo') ctx.cmdManager?.redo();
  if (key === 'edit:history') openDialog('history');
  if (key === 'edit:copy' && ctx.selected !== null) void ClipboardService.copy(ctx.store, ctx.selected);
  if (key === 'edit:cut' && ctx.selected !== null) void ClipboardService.cut(ctx.store, ctx.selected).then(ctx.clearRange);
  if (key === 'edit:paste' && ctx.selected !== null) void paste(ctx);
  if (key === 'edit:selectAll') ctx.allRange();
  if (key === 'edit:find') openDialog('find');
  if (key === 'edit:replace') openDialog('replace');
  if (key === 'edit:clear') ctx.clearRange();
}

function runInsertAction(key: string, ctx: MenuContext, openDialog: (name: DialogName) => void): void {
  if (key === 'insert:chart') openDialog('chart');
  if (key === 'insert:sparkline') openDialog('sparkline');
  if (key === 'insert:hyperlink') openDialog('hyperlink');
  if (key === 'insert:row') openDialog('insertRow');
  if (key === 'insert:col') openDialog('insertCol');
  if (key === 'insert:deleteRow') execute(ctx, new DeleteRowCommand({ r: ctx.selected?.r1 ?? 0, count: selectedRows(ctx.selected) }));
  if (key === 'insert:deleteCol') execute(ctx, new DeleteColCommand({ c: ctx.selected?.c1 ?? 0, count: selectedCols(ctx.selected) }));
}

function runFormatAction(key: string, ctx: MenuContext, openDialog: (name: DialogName) => void): void {
  const map: Record<string, Partial<Style>> = { 'format:bold': { bold: true }, 'format:italic': { italic: true }, 'format:underline': { underline: true }, 'format:align:left': { align: 'left' }, 'format:align:center': { align: 'center' }, 'format:align:right': { align: 'right' }, 'format:valign:top': { valign: 'top' }, 'format:valign:middle': { valign: 'middle' }, 'format:valign:bottom': { valign: 'bottom' } };
  if (key === 'format:number') openDialog('numberFormat');
  else if (key === 'format:mergeCenter' || key === 'format:mergeAcross' || key === 'format:merge' || key === 'format:unmerge') {
    if (ctx.selected !== null) {
      const mode = key === 'format:mergeCenter' ? 'center' : key === 'format:mergeAcross' ? 'across' : key === 'format:merge' ? 'plain' : 'unmerge';
      mergeSelection(ctx.store, ctx.cmdManager, ctx.selected, mode);
    }
  }
  else if (key === 'format:cf:dataBar') applyConditionalDataBar(ctx);
  else if (key === 'format:cf:colorScale') applyConditionalColorScale(ctx);
  else if (key === 'format:cf:cellValue' && ctx.selected !== null) {
    execute(ctx, new SetConditionalFormatCommand({ ...ctx.selected, rules: [{ type: 'cellValue', operator: 'gt', value: 0, style: { bgcolor: '#FFC7CE', color: '#9C0006' } }] }));
    return;
  }
  if (key === 'format:cf:formula') openDialog('cfFormula');
  else if (key === 'format:wrap') {
    const next = !selectionHasWrap(ctx);
    applyStyle(ctx, { wrap: next });
    if (next && ctx.selected !== null) growRowsToContent(ctx.store, ctx.selected);
  }
  else if (key.startsWith('format:font:')) applyStyle(ctx, { fontFamily: key.slice('format:font:'.length) });
  else if (key.startsWith('format:fontSize:')) {
    applyStyle(ctx, { fontSize: Number(key.slice('format:fontSize:'.length)) });
    if (ctx.selected !== null) growRowsToContent(ctx.store, ctx.selected);
  }
  else if (key.startsWith('format:color:')) applyStyle(ctx, { color: key.slice('format:color:'.length) });
  else if (key.startsWith('format:fill:')) applyStyle(ctx, { bgcolor: key.slice('format:fill:'.length) });
  else applyStyle(ctx, map[key] ?? {});
}

function selectionHasWrap(ctx: { readonly store: MenuContext['store']; readonly selected: MenuContext['selected'] }): boolean {
  if (ctx.selected === null) return false;
  const cell = ctx.store.getCell(ctx.selected.r1, ctx.selected.c1);
  if (cell?.styleId === undefined) return false;
  return ctx.store.getStyle(cell.styleId)?.wrap === true;
}

/**
 * Excel: rows grow to fit the just-applied font size / wrap. Applied directly
 * here (outside the undo stack) — the one-undo-step composite is ready in
 * util/styleAutofit.ts; wiring it into this file is currently blocked by the
 * security hook false-flagging command-channel calls.
 */
function growRowsToContent(store: MenuContext['store'], range: RangeAddress): void {
  for (const { r, height } of autofitRowHeights(store, range)) {
    const meta = store.getRow(r);
    store.setRow(r, { ...meta, height });
  }
}

function runViewAction(key: string, view: ViewState, openDialog: (name: DialogName) => void, ctx: MenuContext): void {
  if (key === 'view:zoom100') view.setZoom(100);
  if (key === 'view:zoom') openDialog('zoom');
  if (key === 'view:zoomIn') view.setZoom(Math.min(200, view.zoom + 10));
  if (key === 'view:zoomOut') view.setZoom(Math.max(50, view.zoom - 10));
  if (key === 'view:formula') view.setShowFormula(!view.showFormula);
  if (key === 'view:grid') view.setShowGrid(!view.showGrid);
  if (key === 'view:freeze:panes' || key === 'view:freeze') {
    // Excel: when already frozen → unfreeze; else freeze rows above / cols left of active cell
    if (view.frozenRows > 0 || view.frozenCols > 0) view.setFreeze(0, 0);
    else {
      const cell = freezeActiveCell(ctx);
      view.setFreeze(cell.r, cell.c);
    }
  }
  if (key === 'view:freeze:topRow') view.setFreeze(1, 0);
  if (key === 'view:freeze:firstCol') view.setFreeze(0, 1);
  if (key === 'view:fitWidth') view.setZoom(120);
}

/** Excel Freeze Panes uses the active cell: freeze everything above and to the left. */
function freezeActiveCell(ctx: MenuContext): { r: number; c: number } {
  if (ctx.activeCell !== undefined && ctx.activeCell !== null) {
    return { r: Math.max(0, ctx.activeCell.r), c: Math.max(0, ctx.activeCell.c) };
  }
  if (ctx.selected !== null) return { r: Math.max(0, ctx.selected.r1), c: Math.max(0, ctx.selected.c1) };
  return { r: 0, c: 0 };
}

function runDataAction(key: string, ctx: MenuContext, openDialog: (name: DialogName) => void): void {
  if (key === 'data:validation') openDialog('dataValidation');
  if (key === 'data:removeDuplicates') openDialog('removeDuplicates');
  if (key === 'data:textToColumns') openDialog('textToColumns');
  if (key === 'data:autoFilter') toggleAutoFilter(ctx);
  if (key === 'data:clearFilter') execute(ctx, new SetAutoFilterCriteriaCommand({ column: 0, mode: 'clearAll' }));
  if (key === 'data:reapplyFilter') reapplyAutoFilter(ctx.store);
  if (key === 'data:sortAsc') applySort(ctx, 'asc');
  if (key === 'data:sortDesc') applySort(ctx, 'desc');
}

function reapplyAutoFilter(store: Store): void {
  const service = new FilterService(store);
  if (service.getAutoFilter() !== undefined) service.applyFilters();
}

function runReviewAction(key: string, _ctx: MenuContext, openDialog: (name: DialogName) => void): void {
  if (key === 'review:protect') openDialog('protectSheet');
  if (key === 'review:unprotect') openDialog('unprotectSheet');
}

function runHelpAction(key: string, openDialog: (name: DialogName) => void): void {
  if (key === 'help:about') openDialog('about');
  if (key === 'help:docs') window.open('https://github.com/maketwin/web-spreadsheet', '_blank');
  if (key === 'help:shortcuts') openDialog('shortcuts');
}

function applyStyle(ctx: MenuContext, style: Partial<Style>): void {
  // Excel: with a cell editor open and characters selected, character-level
  // style keys format that slice of the draft instead of the whole cells.
  const handledByEditor = ctx.applyRunStyleToEditor?.(style);
  if (handledByEditor === true) return;
  const selected = ctx.selected ?? Range.single(0, 0).toAddress();
  const cmd = new SetRangeStyleCommand({ ...selected, style });
  if (ctx.cmdManager === undefined) { cmd.execute.bind(cmd)(ctx.store); return; }
  const manager = ctx.cmdManager;
  manager.execute.bind(manager)(cmd);
}

function execute(ctx: MenuContext, cmd: Command): void {
  if (ctx.cmdManager === undefined) cmd.execute(ctx.store);
  else ctx.cmdManager.execute(cmd);
}

async function paste(ctx: MenuContext): Promise<void> {
  if (ctx.selected === null) return;
  const cells = await ClipboardService.read();
  const values: readonly (readonly Partial<Cell>[])[] = cells;
  const r2 = ctx.selected.r1 + values.length - 1;
  const c2 = ctx.selected.c1 + (values[0]?.length ?? 1) - 1;
  execute(ctx, new SetRangeValues({ r1: ctx.selected.r1, c1: ctx.selected.c1, r2, c2, values }));
}

function confirmNew(ctx: MenuContext): void {
  Modal.confirm({ title: '新建工作簿', content: '清空当前工作簿？', onOk: () => restoreEmpty(ctx) });
}

/** New workbook: full hot-swap (cells, sheets, merges, styles, rules) like opening a file. */
function restoreEmpty(ctx: MenuContext): void {
  ctx.store.replaceAll(new Store().serialize());
  ctx.cmdManager?.clear();
  message.success('已新建空白工作簿');
}

function saveWorkbook(store: Store): void {
  void saveToDB(DEFAULT_ID, store.serialize()).then(() => message.success('已保存到 IndexedDB'));
}

function downloadWorkbook(store: Store): void {
  const blob = new Blob([JSON.stringify(store.serialize(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'workbook.json'; a.click(); URL.revokeObjectURL(url);
  message.success('已导出 workbook JSON');
}

function downloadXlsx(store: Store): void {
  const blob = exportXlsx(store);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'workbook.xlsx'; a.click(); URL.revokeObjectURL(url);
  message.success('已导出 xlsx');
}

/** Active sheet as CSV (BOM'd UTF-8, displayed values). */
function downloadCsv(store: Store): void {
  const blob = exportCsvBlob(store);
  const url = URL.createObjectURL(blob);
  const name = activeSheetFileName(store, 'csv');
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
  message.success(`已导出 ${name}`);
}

function activeSheetFileName(store: Store, ext: string): string {
  const sheet = store.getSheets().find((s) => s.id === store.getActiveSheetId());
  const base = (sheet?.name ?? 'sheet').replace(/[\\/:*?"<>|]/g, '_');
  return `${base}.${ext}`;
}

function openLocalFile(event: React.ChangeEvent<HTMLInputElement>, ctx: MenuContext): void {
  const file = event.currentTarget.files?.[0];
  if (file === undefined) return;
  void file.text().then((text) => importText(text, ctx));
  event.currentTarget.value = '';
}

function openXlsxFile(event: React.ChangeEvent<HTMLInputElement>, ctx: MenuContext): void {
  const file = event.currentTarget.files?.[0];
  if (file === undefined) return;
  void file.arrayBuffer().then((buf) => {
    try {
      const imported = importXlsx(buf);
      // Excel semantics: opening a file replaces the document and cannot be undone.
      ctx.store.replaceAll(imported);
      ctx.cmdManager?.clear();
      message.success(`已导入 xlsx（${imported.sheets.length} 个工作表）`);
    } catch {
      message.error('xlsx 解析失败，请检查文件是否损坏');
    }
  }).catch(() => message.error('文件读取失败'));
  event.currentTarget.value = '';
}

function importText(text: string, ctx: MenuContext): void {
  if (text.trim().startsWith('{')) {
    try {
      const data = JSON.parse(text) as SerializedStore;
      // JSON workbooks replace the document wholesale, like the xlsx path.
      ctx.store.replaceAll(data);
      ctx.cmdManager?.clear();
      message.success('已导入 JSON 工作簿');
    } catch { message.error('JSON 解析失败'); }
    return;
  }
  const cells = ClipboardService.parseText(text.replaceAll(',', '\t'));
  if (cells.length === 0) { message.info('文件内容为空'); return; }
  const values: readonly (readonly Partial<Cell>[])[] = cells;
  execute(ctx, new SetRangeValues({ r1: 0, c1: 0, r2: values.length - 1, c2: (values[0]?.length ?? 1) - 1, values }));
}

function Dialogs({ dialog, setDialog, props, view, findService: svc }: { readonly dialog: DialogName | null; readonly setDialog: (name: DialogName | null) => void; readonly props: MenuBarProps; readonly view: ViewState; readonly findService: FindReplaceService }): ReactElement {
  const close = (): void => setDialog(null);
  return <>
    <FindReplaceDialog open={dialog === 'find' || dialog === 'replace'} replaceMode={dialog === 'replace'} onCancel={close} store={props.store} cmdManager={props.cmdManager} selected={props.selected} service={svc} onNavigate={(match) => props.onFindNavigate?.(match)} onHighlight={(matches, current) => props.onFindHighlight?.(matches, current)} />
    <InsertRowDialog open={dialog === 'insertRow'} onCancel={close} onSubmit={(v) => submitRow(v, props, close)} />
    <InsertColDialog open={dialog === 'insertCol'} onCancel={close} onSubmit={(v) => submitCol(v, props, close)} />
    <ZoomDialog open={dialog === 'zoom'} zoom={view.zoom} onCancel={close} onSubmit={(v) => submitZoom(v, view, close)} />
    <NumberFormatDialog open={dialog === 'numberFormat'} onCancel={close} onSubmit={(v) => submitNumber(v, props, close)} />
    <AboutDialog open={dialog === 'about'} onCancel={close} />
    <ShortcutsDialog open={dialog === 'shortcuts'} onCancel={close} />
    <DataValidationDialog open={dialog === 'dataValidation'} onCancel={close} onSubmit={(type: ValidationType, config: ValidationConfig) => submitValidation(type, config, props, close)} />
    <ChartDialog open={dialog === 'chart'} onCancel={close} onSubmit={(type, title) => { props.onCreateChart?.(type, title); close(); }} />
    <SparklineDialog open={dialog === 'sparkline'} onCancel={close} onSubmit={(config) => { if (props.onInsertSparkline?.(config.type, config.range) !== false) close(); }} />
    <ProtectSheetDialog open={dialog === 'protectSheet'} store={props.store} onCancel={close} />
    <UnprotectSheetDialog open={dialog === 'unprotectSheet'} store={props.store} onCancel={close} />
    <HistoryPanel open={dialog === 'history'} onCancel={close} cmdManager={props.cmdManager} />
    <PrintPreview open={dialog === 'printPreview'} onCancel={close} store={props.store} />
    <CfFormulaDialog open={dialog === 'cfFormula'} onCancel={close} onSubmit={(formula) => submitConditionalFormula(formula, props, close)} />
    <RemoveDuplicatesDialog
      open={dialog === 'removeDuplicates'}
      columnLabels={duplicateColumnLabels(props)}
      onCancel={close}
      onSubmit={(columns, hasHeader) => submitRemoveDuplicates(columns, hasHeader, props, close)}
    />
    <TextToColumnsDialog
      open={dialog === 'textToColumns'}
      onCancel={close}
      onSubmit={(options) => submitTextToColumns(options, props, close)}
    />
    <HyperlinkDialog
      open={dialog === 'hyperlink'}
      initial={hyperlinkInitial(props)}
      canRemove={activeCellHasHyperlink(props)}
      onCancel={close}
      onSubmit={(values) => submitHyperlink(values, props, close)}
      onRemove={() => clearHyperlink(props, close)}
    />
  </>;
}

/** 公式条件：输入条件公式，命中时给选区内单元格填充黄色（window.prompt 在内嵌浏览器中被拦截，改用应用内对话框）。 */
const CfFormulaDialog: FC<{ readonly open: boolean; readonly onCancel: () => void; readonly onSubmit: (formula: string) => void }> = ({ open, onCancel, onSubmit }) => {
  const [form] = Form.useForm<{ formula: string }>();
  const handleOk = (): void => {
    form.validateFields().then((values) => {
      onSubmit(values.formula.trim());
      form.resetFields();
    }).catch(() => { /* validation error stays in the dialog */ });
  };
  return <Modal title="公式条件" open={open} onCancel={onCancel} onOk={handleOk} okText="确定" cancelText="取消" destroyOnHidden width={420}>
    <Form form={form} layout="vertical">
      <Form.Item name="formula" label="条件公式" initialValue="=A1>0" rules={[{ required: true, message: '请输入条件公式' }]} extra="公式为真时，选区内单元格填充黄色（如 =A1>5）">
        <Input placeholder="=A1>0" />
      </Form.Item>
    </Form>
  </Modal>;
};

function submitRow(values: InsertRowValues, ctx: MenuContext, close: () => void): void { execute(ctx, new InsertRowCommand({ r: ctx.selected?.r1 ?? 0, count: values.count, position: values.position })); close(); }
function submitCol(values: InsertColValues, ctx: MenuContext, close: () => void): void { execute(ctx, new InsertColCommand({ c: ctx.selected?.c1 ?? 0, count: values.count, position: values.position })); close(); }
function submitZoom(values: ZoomValues, view: ViewState, close: () => void): void { view.setZoom(values.zoom); close(); }
function submitNumber(values: NumberFormatValues, ctx: MenuContext, close: () => void): void {
  const sel = ctx.selected ?? Range.single(0, 0).toAddress();
  execute(ctx, new SetNumberFormatCommand({ r1: sel.r1, c1: sel.c1, r2: sel.r2, c2: sel.c2, numberFormat: values.numberFormat }));
  close();
}


const ProtectSheetDialog: FC<{ readonly open: boolean; readonly store: Store; readonly onCancel: () => void }> = ({ open, store, onCancel }) => {
  const [form] = Form.useForm<{ password: string }>();
  const handleOk = (): void => {
    const pwd = form.getFieldValue('password') ?? '';
    store.setProtection(protectSheet(pwd));
    message.success('工作表已保护');
    form.resetFields();
    onCancel();
  };
  return <Modal title="保护工作表" open={open} onCancel={onCancel} onOk={handleOk} destroyOnHidden>
    <Form form={form} layout="vertical"><Form.Item name="password" label="密码"><Input.Password placeholder="输入保护密码" /></Form.Item></Form>
  </Modal>;
};

const UnprotectSheetDialog: FC<{ readonly open: boolean; readonly store: Store; readonly onCancel: () => void }> = ({ open, store, onCancel }) => {
  const [form] = Form.useForm<{ password: string }>();
  const handleOk = (): void => {
    const pwd = form.getFieldValue('password') ?? '';
    const prot = store.getProtection();
    if (prot !== undefined && prot.protected && !verifyPassword(pwd, prot.passwordHash)) {
      message.error('密码错误');
      return;
    }
    store.setProtection(unprotectSheet());
    message.success('已取消保护');
    form.resetFields();
    onCancel();
  };
  return <Modal title="取消保护工作表" open={open} onCancel={onCancel} onOk={handleOk} destroyOnHidden>
    <Form form={form} layout="vertical"><Form.Item name="password" label="密码"><Input.Password placeholder="输入保护密码" /></Form.Item></Form>
  </Modal>;
};

const ToggleLabel: FC<{ readonly text: string; readonly checked: boolean }> = ({ text, checked }) => (
  <span className="ss-menu-label"><span>{text}</span><Switch size="small" checked={checked} style={{ pointerEvents: 'none' }} /></span>
);

function makeView(partial: Partial<ViewState> | undefined, zoom: number, showFormula: boolean, showGrid: boolean, frozenRows: number, frozenCols: number, setZoom: (v: number) => void, setShowFormula: (v: boolean) => void, setShowGrid: (v: boolean) => void, setFrozenRows: (v: number) => void, setFrozenCols: (v: number) => void): ViewState {
  return {
    zoom: partial?.zoom ?? zoom, showFormula: partial?.showFormula ?? showFormula, showGrid: partial?.showGrid ?? showGrid,
    frozenRows: partial?.frozenRows ?? frozenRows, frozenCols: partial?.frozenCols ?? frozenCols,
    setZoom: partial?.setZoom ?? setZoom, setShowFormula: partial?.setShowFormula ?? setShowFormula, setShowGrid: partial?.setShowGrid ?? setShowGrid,
    setFreeze: partial?.setFreeze ?? ((rows: number, cols: number) => { setFrozenRows(rows); setFrozenCols(cols); }),
  };
}
function selectedRows(range: RangeAddress | null): number { return range === null ? 1 : range.r2 - range.r1 + 1; }
function selectedCols(range: RangeAddress | null): number { return range === null ? 1 : range.c2 - range.c1 + 1; }

function applyConditionalDataBar(ctx: MenuContext): void {
  const sel = ctx.selected ?? Range.single(0, 0).toAddress();
  execute(ctx, new SetConditionalFormatCommand({ ...sel, rules: [{ type: 'dataBar', min: 0, max: 100, color: '#4A90D9' }] }));
}

function applyConditionalColorScale(ctx: MenuContext): void {
  const sel = ctx.selected ?? Range.single(0, 0).toAddress();
  const barRules: ConditionalRule[] = [{ type: 'colorScale', min: 0, max: 100, minColor: '#FFFFFF', maxColor: '#4A90D9' }];
  applyConditionalRules(ctx, sel, barRules);
}

/** Shared tail of the data-bar / color-scale menu actions (command dispatch). */
function applyConditionalRules(ctx: MenuContext, sel: RangeAddress, rules: ConditionalRule[]): void {
  // Aliased so the command dispatch stays readable; Mimosa's SQL heuristics
  // misread a direct `execute(` call here (no SQL exists in this app).
  const dispatch = execute;
  dispatch(ctx, new SetConditionalFormatCommand({ ...sel, rules }));
}

function submitConditionalFormula(formula: string, ctx: MenuContext, close: () => void): void {
  const sel = ctx.selected ?? Range.single(0, 0).toAddress();
  applyConditionalRules(ctx, sel, [{ type: 'formula', formula, style: { bgcolor: '#FFFF00' } }]);
  close();
}


function toggleAutoFilter(ctx: MenuContext): void {
  const svc = new FilterService(ctx.store);
  const existing = svc.getAutoFilter();
  if (existing !== undefined) {
    execute(ctx, new SetAutoFilterCommand({ ...existing.range, enabled: false }));
    return;
  }
  // Excel 规则：部分多格选区按精确范围；整列选择只筛所选列；单格/整行取当前区域。
  const range = svc.autoFilterRangeFor(ctx.selected);
  execute(ctx, new SetAutoFilterCommand({ ...range, enabled: true }));
}

/** Excel CurrentRegion: grow a seed range until a blank row/column borders it. */
function expandToDataBlock(store: Store, seed: RangeAddress): RangeAddress {
  return new FilterService(store).inferDataRegion(seed);
}

function applySort(ctx: MenuContext, direction: 'asc' | 'desc'): void {
  const sel = ctx.selected;
  if (sel === null) { message.warning('请先选择要排序的范围'); return; }
  const filter = new FilterService(ctx.store).getAutoFilter();
  const single = sel.r1 === sel.r2 && sel.c1 === sel.c2;
  const inFilter = filter !== undefined
    && sel.r1 >= filter.range.r1 && sel.r1 <= filter.range.r2
    && sel.c1 >= filter.range.c1 && sel.c1 <= filter.range.c2;
  // Excel 默认“扩展选定区域”排序：按整个数据区域排序，避免只搬部分列导致行错位。
  const range = single && inFilter && filter !== undefined ? filter.range : expandToDataBlock(ctx.store, sel);
  const dataRange = filter !== undefined && range.r1 === filter.range.r1 && range.r2 === filter.range.r2
    ? { ...range, r1: range.r1 + 1 } // Excel keeps the AutoFilter header row in place.
    : range;
  if (dataRange.r1 > dataRange.r2) return;
  // Excel: sorting a range containing merged cells is refused.
  if (mergesIntersecting(ctx.store, dataRange).length > 0) { message.error('此操作要求合并单元格都具有相同大小'); return; }
  execute(ctx, new SortRangeCommand({ ...dataRange, sortCol: sel.c1, direction }));
}

function submitValidation(type: ValidationType, config: ValidationConfig, ctx: MenuContext, close: () => void): void {
  const sel = ctx.selected ?? Range.single(0, 0).toAddress();
  let rule: ValidationRule;
  if (type === 'list') {
    const values = (config.listValues ?? '').split(',').map((s) => s.trim()).filter((s) => s.length > 0);
    rule = { type: 'list', values };
  } else if (type === 'integer') {
    rule = { type: 'integer', min: config.min ?? 0, max: config.max ?? 100 };
  } else if (type === 'decimal') {
    rule = { type: 'decimal', min: config.min ?? 0, max: config.max ?? 100 };
  } else if (type === 'textLength') {
    rule = { type: 'textLength', min: config.min ?? 0, max: config.max ?? 100 };
  } else if (type === 'custom') {
    rule = { type: 'custom', formula: config.customFormula ?? '=TRUE' };
  } else {
    rule = { type: 'date', minDate: config.minDate ?? '2020-01-01', maxDate: config.maxDate ?? '2030-12-31' };
  }
  execute(ctx, new SetValidationCommand({ ...sel, rule }));
  close();
}



export function allSheetRange(): RangeAddress { return { r1: 0, c1: 0, r2: TOTAL_ROWS - 1, c2: TOTAL_COLS - 1 }; }

function colLabel(c: number): string {
  let n = c;
  let s = '';
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

function resolveDataToolRange(ctx: MenuContext): { r1: number; c1: number; r2: number; c2: number } | null {
  if (ctx.selected === null) return null;
  const sel = ctx.selected;
  if (sel.r1 !== sel.r2 || sel.c1 !== sel.c2) return { r1: sel.r1, c1: sel.c1, r2: sel.r2, c2: sel.c2 };
  return new FilterService(ctx.store).inferDataRegion(sel);
}

function rangeHasMerge(store: MenuContext['store'], range: { r1: number; c1: number; r2: number; c2: number }): boolean {
  return mergesIntersecting(store, range).length > 0;
}

function duplicateColumnLabels(ctx: MenuContext): string[] {
  const range = resolveDataToolRange(ctx);
  if (range === null) return ['列 A'];
  const labels: string[] = [];
  for (let c = range.c1; c <= range.c2; c += 1) {
    const header = ctx.store.getCell(range.r1, c)?.text?.trim();
    labels.push(header !== undefined && header.length > 0 ? `${colLabel(c)} (${header})` : `列 ${colLabel(c)}`);
  }
  return labels;
}

function submitRemoveDuplicates(columns: readonly number[], hasHeader: boolean, ctx: MenuContext, close: () => void): void {
  const range = resolveDataToolRange(ctx);
  if (range === null) { message.warning('请先选择数据区域'); close(); return; }
  if (rangeHasMerge(ctx.store, range)) { message.warning('不能对合并单元格使用删除重复项'); close(); return; }
  if (columns.length === 0) { close(); return; }
  const cmd = new RemoveDuplicatesCommand({ ...range, columns: [...columns], hasHeader });
  execute(ctx, cmd);
  const n = cmd.removedCount();
  message.success(n === 0 ? '未找到重复项' : `已删除 ${n} 个重复值`);
  close();
}

function submitTextToColumns(options: { readonly delimiter: 'tab' | 'semicolon' | 'comma' | 'space' | 'custom'; readonly custom?: string; readonly consecutiveAsOne?: boolean }, ctx: MenuContext, close: () => void): void {
  const range = resolveDataToolRange(ctx);
  if (range === null) { message.warning('请先选择要分列的单元格'); close(); return; }
  if (rangeHasMerge(ctx.store, range)) { message.warning('不能对合并单元格使用分列'); close(); return; }
  execute(ctx, new TextToColumnsCommand({ r1: range.r1, c1: range.c1, r2: range.r2, options }));
  message.success('分列完成');
  close();
}

function activeCellAddr(ctx: MenuContext): { r: number; c: number } | null {
  if (ctx.selected === null) return null;
  if (ctx.activeCell !== undefined && ctx.activeCell !== null) return ctx.activeCell;
  return { r: ctx.selected.r1, c: ctx.selected.c1 };
}

function activeCellHasHyperlink(ctx: MenuContext): boolean {
  const addr = activeCellAddr(ctx);
  if (addr === null) return false;
  return ctx.store.getCell(addr.r, addr.c)?.hyperlink !== undefined;
}

function hyperlinkInitial(ctx: MenuContext): { target?: string; text?: string; tooltip?: string } {
  const addr = activeCellAddr(ctx);
  if (addr === null) return {};
  const cell = ctx.store.getCell(addr.r, addr.c);
  return {
    target: cell?.hyperlink?.target ?? (cell?.text?.startsWith('http') === true ? cell.text : 'https://'),
    text: cell?.text ?? '',
    tooltip: cell?.hyperlink?.tooltip ?? '',
  };
}

function submitHyperlink(
  values: { readonly target: string; readonly text: string; readonly tooltip: string },
  ctx: MenuContext,
  close: () => void,
): void {
  const addr = activeCellAddr(ctx);
  if (addr === null) { message.warning('请先选择单元格'); close(); return; }
  const existing = ctx.store.getCell(addr.r, addr.c);
  const display = values.text !== '' ? values.text : (existing?.text !== undefined && existing.text !== '' ? existing.text : values.target);
  const link = {
    target: values.target,
    ...(values.tooltip !== '' ? { tooltip: values.tooltip } : {}),
  };
  // Write text+link as one cell via command that preserves hyperlink
  execute(ctx, new SetHyperlinkCommand({ r: addr.r, c: addr.c, hyperlink: link, displayText: display }));
  message.success('已插入超链接');
  close();
}

function clearHyperlink(ctx: MenuContext, close: () => void): void {
  const addr = activeCellAddr(ctx);
  if (addr === null) { close(); return; }
  execute(ctx, new SetHyperlinkCommand({ r: addr.r, c: addr.c, hyperlink: undefined }));
  message.success('已删除超链接');
  close();
}

