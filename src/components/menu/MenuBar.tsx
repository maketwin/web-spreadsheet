import { BarChartOutlined, EditOutlined, FileOutlined, FormatPainterOutlined, QuestionCircleOutlined, SettingOutlined, TableOutlined } from '@ant-design/icons';
import { Dropdown, Form, InputNumber, Modal, Switch, message } from 'antd';
import type { MenuProps } from 'antd';
import { useMemo, useRef, useState, useEffect, type FC, type ReactElement, type ReactNode } from 'react';
import { ClipboardService } from '../../clipboard/ClipboardService';
import { DeleteColCommand } from '../../commands/impl/DeleteCol';
import { DeleteRowCommand } from '../../commands/impl/DeleteRow';
import { InsertColCommand } from '../../commands/impl/InsertCol';
import { InsertRowCommand } from '../../commands/impl/InsertRow';
import { SetMerge } from '../../commands/impl/SetMerge';
import { SetRangeStyleCommand } from '../../commands/impl/SetRangeStyle';
import { SetRangeValues } from '../../commands/impl/SetRangeValues';
import { SetNumberFormatCommand } from '../../commands/impl/SetNumberFormat';
import { SetConditionalFormatCommand } from '../../commands/impl/SetConditionalFormat';
import { FindReplaceService } from '../../find/FindReplaceService';
import { TOTAL_COLS, TOTAL_ROWS } from '../../renderer/CanvasRenderer';
import { Range, type RangeAddress } from '../../selection/Range';
import { Store } from '../../store/Store';
import type { Command } from '../../commands/Command';
import type { Cell, Style } from '../../types';
import { xy2expr } from '../../util/alphabet';
import { saveWorkbook as saveToDB, DEFAULT_ID } from '../../db/WorkbookDB';
import { exportXlsx } from '../../io/XlsxExporter';
import { importXlsx } from '../../io/XlsxImporter';
import { AboutDialog } from './dialogs/AboutDialog';
import { ChartStubDialog } from './dialogs/ChartStubDialog';
import { FindReplaceDialog } from './dialogs/FindReplaceDialog';
import { InsertColDialog, type InsertColValues } from './dialogs/InsertColDialog';
import { InsertRowDialog, type InsertRowValues } from './dialogs/InsertRowDialog';
import { NumberFormatDialog, type NumberFormatValues } from './dialogs/NumberFormatDialog';
import { ShortcutsDialog } from './dialogs/ShortcutsDialog';
import { ZoomDialog, type ZoomValues } from './dialogs/ZoomDialog';
import { shortcutLabel } from './shortcutLabel';
import type { DialogName, MenuActions, MenuContext, ViewState } from './types';
import { HistoryPanel } from '../HistoryPanel';
import { PrintPreview } from '../PrintPreview';

export interface MenuBarProps extends MenuContext {
  readonly view?: Partial<ViewState>;
  readonly onFindNavigate?: (cell: import('../../renderer/coordinate').CellAddress) => void;
  readonly onFindHighlight?: (cells: readonly import('../../renderer/coordinate').CellAddress[]) => void;
  readonly openDialogKey?: DialogName | null;
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

  const menus = topMenus(actions, view);
  return <div className="ss-menu-bar" role="menubar" aria-label="Spreadsheet menu">
    <div className="ss-menu-strip">
      {menus.map((menu) => <Dropdown key={menu.key} trigger={['click']} placement="bottomLeft" menu={{ items: menu.items, onClick: ({ key }) => actions.run(String(key)) }}>
        <button className="ss-menu-trigger" type="button" role="menuitem" aria-haspopup="menu">
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

function topMenus(actions: MenuActions, view: ViewState): readonly TopMenu[] {
  void actions;
  return [
    { key: 'file', label: '文件(F)', icon: <FileOutlined />, items: fileItems() },
    { key: 'edit', label: '编辑(E)', icon: <EditOutlined />, items: editItems() },
    { key: 'view', label: '视图(V)', icon: <TableOutlined />, items: viewItems(view) },
    { key: 'insert', label: '插入(I)', icon: <BarChartOutlined />, items: insertItems() },
    { key: 'format', label: '格式(O)', icon: <FormatPainterOutlined />, items: formatItems() },
    { key: 'tools', label: '工具(T)', icon: <SettingOutlined />, items: toolsItems() },
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
    item('file:exportXlsx', '导出 xlsx'),
    divider('file:divider:2'),
    item('file:printPreview', '打印预览...'),
    item('file:exportPdf', '导出 PDF'),
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
  return [
    item('view:zoom100', shortcutLabel('100%', 'Ctrl+0')),
    item('view:zoom', '缩放级别...'),
    item('view:zoomIn', shortcutLabel('放大', 'Ctrl++')),
    item('view:zoomOut', shortcutLabel('缩小', 'Ctrl+-')),
    divider('view:divider:1'),
    item('view:formula', <ToggleLabel text="显示公式" checked={view.showFormula} />),
    item('view:grid', <ToggleLabel text="显示网格线" checked={view.showGrid} />),
    divider('view:divider:2'),
    item('view:freeze', view.frozenRows > 0 || view.frozenCols > 0 ? '取消冻结窗格' : '冻结窗格'),
    item('view:fitWidth', '适应窗口宽度'),
  ];
}

function insertItems(): NonNullable<MenuProps['items']> {
  return [
    item('insert:row', '插入行...'),
    item('insert:col', '插入列...'),
    item('insert:deleteRow', '删除行'),
    item('insert:deleteCol', '删除列'),
    divider('insert:divider:1'),
    item('insert:image', '图片...'),
    item('insert:chart', '图表...'),
  ];
}

function formatItems(): NonNullable<MenuProps['items']> {
  return [
    item('format:bold', shortcutLabel('加粗', 'Ctrl+B')),
    item('format:italic', shortcutLabel('斜体', 'Ctrl+I')),
    item('format:underline', shortcutLabel('下划线', 'Ctrl+U')),
    divider('format:divider:1'),
    { key: 'format:align', label: '对齐', children: [item('format:align:left', '左对齐'), item('format:align:center', '居中'), item('format:align:right', '右对齐')] },
    item('format:wrap', '自动换行'),
    divider('format:divider:2'),
    item('format:merge', '合并单元格'),
    item('format:unmerge', '取消合并'),
    divider('format:divider:3'),
    item('format:number', '数字格式...'),
    divider('format:divider:4'),
    { key: 'format:conditional', label: '条件格式', children: [item('format:cf:dataBar', '数据条'), item('format:cf:colorScale', '色阶'), item('format:cf:formula', '公式条件')] },
  ];
}

function toolsItems(): NonNullable<MenuProps['items']> {
  return [item('tools:macro', '宏...'), item('tools:options', '选项...'), item('tools:plugins', '插件管理...')];
}

function helpItems(): NonNullable<MenuProps['items']> {
  return [item('help:docs', '文档'), item('help:shortcuts', '快捷键'), divider('help:divider:1'), item('help:about', '关于')];
}

function item(key: string, label: ReactNode): NonNullable<MenuProps['items']>[number] {
  return { key, label };
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
  else if (key.startsWith('view:')) runViewAction(key, view, openDialog);
  else if (key.startsWith('tools:')) runToolsAction(key, openDialog);
  else if (key.startsWith('help:')) runHelpAction(key, openDialog);
}

function runFileAction(key: string, ctx: MenuContext, openDialog: (name: DialogName) => void, fileInput: React.RefObject<HTMLInputElement | null>, xlsxInput: React.RefObject<HTMLInputElement | null>): void {
  if (key === 'file:new') confirmNew(ctx);
  if (key === 'file:open' || key === 'file:import') fileInput.current?.click();
  if (key === 'file:importXlsx') xlsxInput.current?.click();
  if (key === 'file:save') saveWorkbook(ctx.store);
  if (key === 'file:saveAs' || key === 'file:export') downloadWorkbook(ctx.store);
  if (key === 'file:exportXlsx') downloadXlsx(ctx.store);
  if (key === 'file:printPreview') openDialog('printPreview');
  if (key === 'file:exportPdf') openDialog('printPreview');
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
  if (key === 'insert:row') openDialog('insertRow');
  if (key === 'insert:col') openDialog('insertCol');
  if (key === 'insert:deleteRow') execute(ctx, new DeleteRowCommand({ r: ctx.selected?.r1 ?? 0, count: selectedRows(ctx.selected) }));
  if (key === 'insert:deleteCol') execute(ctx, new DeleteColCommand({ c: ctx.selected?.c1 ?? 0, count: selectedCols(ctx.selected) }));
  if (key === 'insert:image') message.info('图片入口已触发，渲染层待接入');
  if (key === 'insert:chart') openDialog('chart');
}

function runFormatAction(key: string, ctx: MenuContext, openDialog: (name: DialogName) => void): void {
  const map: Record<string, Partial<Style>> = { 'format:bold': { bold: true }, 'format:italic': { italic: true }, 'format:underline': { underline: true }, 'format:wrap': { wrap: true }, 'format:align:left': { align: 'left' }, 'format:align:center': { align: 'center' }, 'format:align:right': { align: 'right' } };
  if (key === 'format:number') openDialog('numberFormat');
  else if (key === 'format:merge') execute(ctx, new SetMerge({ range: rangeName(ctx.selected), active: true }));
  else if (key === 'format:unmerge') execute(ctx, new SetMerge({ range: rangeName(ctx.selected), active: false }));
  else if (key === 'format:cf:dataBar') applyConditionalDataBar(ctx);
  else if (key === 'format:cf:colorScale') applyConditionalColorScale(ctx);
  else if (key === 'format:cf:formula') applyConditionalFormula(ctx);
  else applyStyle(ctx, map[key] ?? {});
}

function runViewAction(key: string, view: ViewState, openDialog: (name: DialogName) => void): void {
  if (key === 'view:zoom100') view.setZoom(100);
  if (key === 'view:zoom') openDialog('zoom');
  if (key === 'view:zoomIn') view.setZoom(Math.min(200, view.zoom + 10));
  if (key === 'view:zoomOut') view.setZoom(Math.max(50, view.zoom - 10));
  if (key === 'view:formula') view.setShowFormula(!view.showFormula);
  if (key === 'view:grid') view.setShowGrid(!view.showGrid);
  if (key === 'view:freeze') {
    if (view.frozenRows > 0 || view.frozenCols > 0) view.setFreeze(0, 0);
    else view.setFreeze(1, 1);
  }
  if (key === 'view:fitWidth') view.setZoom(120);
}

function runToolsAction(key: string, openDialog: (name: DialogName) => void): void {
  if (key === 'tools:macro') message.info('宏入口已触发');
  if (key === 'tools:options') openDialog('options');
  if (key === 'tools:plugins') openDialog('plugins');
}

function runHelpAction(key: string, openDialog: (name: DialogName) => void): void {
  if (key === 'help:about') openDialog('about');
  if (key === 'help:docs') window.open('https://github.com/maketwin/web-spreadsheet', '_blank');
  if (key === 'help:shortcuts') openDialog('shortcuts');
}

function applyStyle(ctx: MenuContext, style: Partial<Style>): void {
  const selected = ctx.selected ?? Range.single(0, 0).toAddress();
  execute(ctx, new SetRangeStyleCommand({ ...selected, style }));
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
  Modal.confirm({ title: '新建工作簿', content: '清空当前工作簿？', onOk: () => restoreEmpty(ctx.store) });
}

function restoreEmpty(store: Store): void {
  const empty = new Store();
  store.getCells().forEach(([key]) => { const [r, c] = key.split(',').map(Number); store.setCell(r ?? 0, c ?? 0, undefined); });
  empty.getSheets().forEach((sheet) => store.renameSheet(sheet.id, sheet.name));
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
    const result = importXlsx(buf);
    const first = result.sheets[0];
    if (first === undefined) { message.info('xlsx 文件为空'); return; }
    const values = first.cells;
    execute(ctx, new SetRangeValues({ r1: 0, c1: 0, r2: values.length - 1, c2: (values[0]?.length ?? 1) - 1, values }));
    message.success(`已导入 xlsx (${result.sheets.length} 个工作表)`);
  });
  event.currentTarget.value = '';
}

function importText(text: string, ctx: MenuContext): void {
  if (text.trim().startsWith('{')) {
    try {
      const data = JSON.parse(text) as import('../../store/Store').SerializedStore;
      const restored = Store.deserialize(data);
      restored.getCells().forEach(([key, cell]) => { const [r, c] = key.split(',').map(Number); ctx.store.setCell(r ?? 0, c ?? 0, cell); });
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
    <FindReplaceDialog open={dialog === 'find' || dialog === 'replace'} replaceMode={dialog === 'replace'} onCancel={close} store={props.store} selected={props.selected} service={svc} onNavigate={(cell) => props.onFindNavigate?.(cell)} onHighlight={(cells) => props.onFindHighlight?.(cells)} />
    <InsertRowDialog open={dialog === 'insertRow'} onCancel={close} onSubmit={(v) => submitRow(v, props, close)} />
    <InsertColDialog open={dialog === 'insertCol'} onCancel={close} onSubmit={(v) => submitCol(v, props, close)} />
    <ZoomDialog open={dialog === 'zoom'} zoom={view.zoom} onCancel={close} onSubmit={(v) => submitZoom(v, view, close)} />
    <NumberFormatDialog open={dialog === 'numberFormat'} onCancel={close} onSubmit={(v) => submitNumber(v, props, close)} />
    <AboutDialog open={dialog === 'about'} onCancel={close} />
    <ShortcutsDialog open={dialog === 'shortcuts'} onCancel={close} />
    <ChartStubDialog open={dialog === 'chart'} onCancel={close} />
    <OptionsDialog open={dialog === 'options'} onCancel={close} />
    <PluginsDialog open={dialog === 'plugins'} onCancel={close} />
    <HistoryPanel open={dialog === 'history'} onCancel={close} cmdManager={props.cmdManager} />
    <PrintPreview open={dialog === 'printPreview'} onCancel={close} />
  </>;
}

function submitRow(values: InsertRowValues, ctx: MenuContext, close: () => void): void { execute(ctx, new InsertRowCommand({ r: ctx.selected?.r1 ?? 0, count: values.count, position: values.position })); close(); }
function submitCol(values: InsertColValues, ctx: MenuContext, close: () => void): void { execute(ctx, new InsertColCommand({ c: ctx.selected?.c1 ?? 0, count: values.count, position: values.position })); close(); }
function submitZoom(values: ZoomValues, view: ViewState, close: () => void): void { view.setZoom(values.zoom); close(); }
function submitNumber(values: NumberFormatValues, ctx: MenuContext, close: () => void): void {
  const sel = ctx.selected ?? Range.single(0, 0).toAddress();
  execute(ctx, new SetNumberFormatCommand({ r1: sel.r1, c1: sel.c1, r2: sel.r2, c2: sel.c2, numberFormat: values.numberFormat }));
  close();
}

const OptionsDialog: FC<{ readonly open: boolean; readonly onCancel: () => void }> = ({ open, onCancel }) => <Modal title="选项" open={open} onCancel={onCancel} onOk={onCancel}>
  <Form layout="vertical"><Form.Item label="默认字号"><InputNumber defaultValue={14} min={8} max={72} /></Form.Item><Form.Item label="默认列宽"><InputNumber defaultValue={100} min={40} max={400} /></Form.Item><Form.Item label="启用网格线"><Switch defaultChecked /></Form.Item></Form>
</Modal>;
const PluginsDialog: FC<{ readonly open: boolean; readonly onCancel: () => void }> = ({ open, onCancel }) => <Modal title="插件管理" open={open} onCancel={onCancel} onOk={onCancel}>已装插件：csv-import <Switch size="small" defaultChecked /></Modal>;

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
function rangeName(range: RangeAddress | null): string { const r = range ?? Range.single(0, 0).toAddress(); return `${xy2expr(r.c1, r.r1)}:${xy2expr(r.c2, r.r2)}`; }

function applyConditionalDataBar(ctx: MenuContext): void {
  const sel = ctx.selected ?? Range.single(0, 0).toAddress();
  execute(ctx, new SetConditionalFormatCommand({ ...sel, rules: [{ type: 'dataBar', min: 0, max: 100, color: '#4A90D9' }] }));
}

function applyConditionalColorScale(ctx: MenuContext): void {
  const sel = ctx.selected ?? Range.single(0, 0).toAddress();
  execute(ctx, new SetConditionalFormatCommand({ ...sel, rules: [{ type: 'colorScale', min: 0, max: 100, minColor: '#FFFFFF', maxColor: '#4A90D9' }] }));
}

function applyConditionalFormula(ctx: MenuContext): void {
  const formula = window.prompt('Conditional formula (e.g. =A1>5)', '=A1>0');
  if (formula === null) return;
  const sel = ctx.selected ?? Range.single(0, 0).toAddress();
  execute(ctx, new SetConditionalFormatCommand({ ...sel, rules: [{ type: 'formula', formula, style: { bgcolor: '#FFFF00' } }] }));
}
export function allSheetRange(): RangeAddress { return { r1: 0, c1: 0, r2: TOTAL_ROWS - 1, c2: TOTAL_COLS - 1 }; }
