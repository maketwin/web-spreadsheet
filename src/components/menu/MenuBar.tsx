import { BarChartOutlined, EditOutlined, FileOutlined, FormatPainterOutlined, QuestionCircleOutlined, SettingOutlined, TableOutlined } from '@ant-design/icons';
import { Dropdown, Form, InputNumber, Menu, Modal, Switch, message } from 'antd';
import type { MenuProps } from 'antd';
import { useMemo, useRef, useState, type FC, type ReactElement } from 'react';
import { ClipboardService } from '../../clipboard/ClipboardService';
import { DeleteColCommand } from '../../commands/impl/DeleteCol';
import { DeleteRowCommand } from '../../commands/impl/DeleteRow';
import { InsertColCommand } from '../../commands/impl/InsertCol';
import { InsertRowCommand } from '../../commands/impl/InsertRow';
import { SetMerge } from '../../commands/impl/SetMerge';
import { SetRangeStyleCommand } from '../../commands/impl/SetRangeStyle';
import { SetRangeValues } from '../../commands/impl/SetRangeValues';
import { TOTAL_COLS, TOTAL_ROWS } from '../../renderer/CanvasRenderer';
import { Range, type RangeAddress } from '../../selection/Range';
import { Store } from '../../store/Store';
import type { Command } from '../../commands/Command';
import type { Cell, Style } from '../../types';
import { xy2expr } from '../../util/alphabet';
import { AboutDialog } from './dialogs/AboutDialog';
import { FindReplaceDialog, type FindReplaceValues } from './dialogs/FindReplaceDialog';
import { InsertColDialog, type InsertColValues } from './dialogs/InsertColDialog';
import { InsertRowDialog, type InsertRowValues } from './dialogs/InsertRowDialog';
import { NumberFormatDialog, type NumberFormatValues } from './dialogs/NumberFormatDialog';
import { ShortcutsDialog } from './dialogs/ShortcutsDialog';
import { ZoomDialog, type ZoomValues } from './dialogs/ZoomDialog';
import { EditMenu } from './EditMenu';
import { FileMenu } from './FileMenu';
import { FormatMenu } from './FormatMenu';
import { HelpMenu } from './HelpMenu';
import { InsertMenu } from './InsertMenu';
import { ToolsMenu } from './ToolsMenu';
import type { DialogName, MenuActions, MenuContext, ViewState } from './types';
import { ViewMenu } from './ViewMenu';

export interface MenuBarProps extends MenuContext { readonly view?: Partial<ViewState> }

export const MenuBar: FC<MenuBarProps> = (props) => {
  const [dialog, setDialog] = useState<DialogName | null>(null);
  const [zoom, setZoom] = useState(props.view?.zoom ?? 100);
  const [showFormula, setShowFormula] = useState(props.view?.showFormula ?? false);
  const [showGrid, setShowGrid] = useState(props.view?.showGrid ?? true);
  const fileInput = useRef<HTMLInputElement>(null);
  const view = makeView(props.view, zoom, showFormula, showGrid, setZoom, setShowFormula, setShowGrid);
  const actions = useMemo(() => makeActions(props, setDialog, view, fileInput), [props, view]);

  const items = topItems(actions, view);
  return <div className="ss-menu-bar">
    <Menu mode="horizontal" selectable={false} triggerSubMenuAction="click" items={items} />
    <input ref={fileInput} hidden type="file" accept=".csv,.tsv,.xlsx,.json" onChange={(e) => openLocalFile(e, props)} />
    <Dialogs dialog={dialog} setDialog={setDialog} props={props} view={view} />
  </div>;
};

function topItems(actions: MenuActions, view: ViewState): NonNullable<MenuProps['items']> {
  return [
    top('file', '文件(F)', <FileOutlined />, <FileMenu actions={actions} />),
    top('edit', '编辑(E)', <EditOutlined />, <EditMenu actions={actions} />),
    top('view', '视图(V)', <TableOutlined />, <ViewMenu actions={actions} view={view} />),
    top('insert', '插入(I)', <BarChartOutlined />, <InsertMenu actions={actions} />),
    top('format', '格式(O)', <FormatPainterOutlined />, <FormatMenu actions={actions} />),
    top('tools', '工具(T)', <SettingOutlined />, <ToolsMenu actions={actions} />),
    top('help', '帮助(H)', <QuestionCircleOutlined />, <HelpMenu actions={actions} />),
  ];
}

function top(key: string, label: string, icon: ReactElement, overlay: ReactElement): NonNullable<MenuProps['items']>[number] {
  return { key, icon, label: <Dropdown trigger={['click']} popupRender={() => overlay}><span>{label}</span></Dropdown> };
}

function makeActions(ctx: MenuContext, openDialog: (name: DialogName) => void, view: ViewState, fileInput: React.RefObject<HTMLInputElement | null>): MenuActions {
  return { run: (key) => runMenuAction(String(key), ctx, openDialog, view, fileInput), openDialog, applyStyle: (style) => applyStyle(ctx, style) };
}

function runMenuAction(key: string, ctx: MenuContext, openDialog: (name: DialogName) => void, view: ViewState, fileInput: React.RefObject<HTMLInputElement | null>): void {
  if (key.startsWith('file:')) runFileAction(key, ctx, fileInput);
  else if (key.startsWith('edit:')) runEditAction(key, ctx, openDialog);
  else if (key.startsWith('insert:')) runInsertAction(key, ctx, openDialog);
  else if (key.startsWith('format:')) runFormatAction(key, ctx, openDialog);
  else if (key.startsWith('view:')) runViewAction(key, view, openDialog);
  else if (key.startsWith('tools:')) runToolsAction(key, openDialog);
  else if (key.startsWith('help:')) runHelpAction(key, openDialog);
}

function runFileAction(key: string, ctx: MenuContext, fileInput: React.RefObject<HTMLInputElement | null>): void {
  if (key === 'file:new') confirmNew(ctx);
  if (key === 'file:open' || key === 'file:import') fileInput.current?.click();
  if (key === 'file:save') saveWorkbook(ctx.store);
  if (key === 'file:saveAs' || key === 'file:export') downloadWorkbook(ctx.store);
  if (key === 'file:close') ctx.closeDemo?.();
}

function runEditAction(key: string, ctx: MenuContext, openDialog: (name: DialogName) => void): void {
  if (key === 'edit:undo') ctx.cmdManager?.undo();
  if (key === 'edit:redo') ctx.cmdManager?.redo();
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
  if (key === 'insert:merge') execute(ctx, new SetMerge({ range: rangeName(ctx.selected), active: true }));
  if (key === 'insert:unmerge') execute(ctx, new SetMerge({ range: rangeName(ctx.selected), active: false }));
  if (key === 'insert:image' || key === 'insert:chart') message.info(`${key.endsWith('image') ? '图片' : '图表'}入口已触发，渲染层待接入`);
}

function runFormatAction(key: string, ctx: MenuContext, openDialog: (name: DialogName) => void): void {
  const map: Record<string, Partial<Style>> = { 'format:bold': { bold: true }, 'format:italic': { italic: true }, 'format:underline': { underline: true }, 'format:wrap': { wrap: true }, 'format:align:left': { align: 'left' }, 'format:align:center': { align: 'center' }, 'format:align:right': { align: 'right' } };
  if (key === 'format:number') openDialog('numberFormat');
  else applyStyle(ctx, map[key] ?? {});
}

function runViewAction(key: string, view: ViewState, openDialog: (name: DialogName) => void): void {
  if (key === 'view:zoom100') view.setZoom(100);
  if (key === 'view:zoom') openDialog('zoom');
  if (key === 'view:zoomIn') view.setZoom(Math.min(200, view.zoom + 10));
  if (key === 'view:zoomOut') view.setZoom(Math.max(50, view.zoom - 10));
  if (key === 'view:freeze') message.info('冻结窗格 TODO 已记录');
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
  window.localStorage.setItem('web-spreadsheet:workbook', JSON.stringify(store.serialize()));
  message.success('已保存到本地存储');
}

function downloadWorkbook(store: Store): void {
  const blob = new Blob([JSON.stringify(store.serialize(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'workbook.json'; a.click(); URL.revokeObjectURL(url);
  message.success('已导出 workbook JSON');
}

function openLocalFile(event: React.ChangeEvent<HTMLInputElement>, ctx: MenuContext): void {
  const file = event.currentTarget.files?.[0];
  if (file === undefined) return;
  void file.text().then((text) => importText(text, ctx));
  event.currentTarget.value = '';
}

function importText(text: string, ctx: MenuContext): void {
  const cells = text.trim().startsWith('{') ? [] : ClipboardService.parseText(text.replaceAll(',', '\t'));
  if (cells.length === 0) { message.info('当前打开入口已触发；xlsx 解析器待接入'); return; }
  const values: readonly (readonly Partial<Cell>[])[] = cells;
  execute(ctx, new SetRangeValues({ r1: 0, c1: 0, r2: values.length - 1, c2: (values[0]?.length ?? 1) - 1, values }));
}

function Dialogs({ dialog, setDialog, props, view }: { readonly dialog: DialogName | null; readonly setDialog: (name: DialogName | null) => void; readonly props: MenuBarProps; readonly view: ViewState }): ReactElement {
  const close = (): void => setDialog(null);
  return <>
    <FindReplaceDialog open={dialog === 'find' || dialog === 'replace'} replaceMode={dialog === 'replace'} onCancel={close} onSubmit={(v) => submitFind(v, close)} />
    <InsertRowDialog open={dialog === 'insertRow'} onCancel={close} onSubmit={(v) => submitRow(v, props, close)} />
    <InsertColDialog open={dialog === 'insertCol'} onCancel={close} onSubmit={(v) => submitCol(v, props, close)} />
    <ZoomDialog open={dialog === 'zoom'} zoom={view.zoom} onCancel={close} onSubmit={(v) => submitZoom(v, view, close)} />
    <NumberFormatDialog open={dialog === 'numberFormat'} onCancel={close} onSubmit={(v) => submitNumber(v, props, close)} />
    <AboutDialog open={dialog === 'about'} onCancel={close} />
    <ShortcutsDialog open={dialog === 'shortcuts'} onCancel={close} />
    <OptionsDialog open={dialog === 'options'} onCancel={close} />
    <PluginsDialog open={dialog === 'plugins'} onCancel={close} />
  </>;
}

function submitFind(values: FindReplaceValues, close: () => void): void { message.info(`查找: ${values.find}${values.replace === undefined ? '' : ` → ${values.replace}`}`); close(); }
function submitRow(values: InsertRowValues, ctx: MenuContext, close: () => void): void { execute(ctx, new InsertRowCommand({ r: ctx.selected?.r1 ?? 0, count: values.count, position: values.position })); close(); }
function submitCol(values: InsertColValues, ctx: MenuContext, close: () => void): void { execute(ctx, new InsertColCommand({ c: ctx.selected?.c1 ?? 0, count: values.count, position: values.position })); close(); }
function submitZoom(values: ZoomValues, view: ViewState, close: () => void): void { view.setZoom(values.zoom); close(); }
function submitNumber(values: NumberFormatValues, ctx: MenuContext, close: () => void): void { applyStyle(ctx, { numberFormat: values.numberFormat }); close(); }

const OptionsDialog: FC<{ readonly open: boolean; readonly onCancel: () => void }> = ({ open, onCancel }) => <Modal title="选项" open={open} onCancel={onCancel} onOk={onCancel}>
  <Form layout="vertical"><Form.Item label="默认字号"><InputNumber defaultValue={14} min={8} max={72} /></Form.Item><Form.Item label="默认列宽"><InputNumber defaultValue={100} min={40} max={400} /></Form.Item><Form.Item label="启用网格线"><Switch defaultChecked /></Form.Item></Form>
</Modal>;
const PluginsDialog: FC<{ readonly open: boolean; readonly onCancel: () => void }> = ({ open, onCancel }) => <Modal title="插件管理" open={open} onCancel={onCancel} onOk={onCancel}>已装插件：csv-import <Switch size="small" defaultChecked /></Modal>;

function makeView(partial: Partial<ViewState> | undefined, zoom: number, showFormula: boolean, showGrid: boolean, setZoom: (v: number) => void, setShowFormula: (v: boolean) => void, setShowGrid: (v: boolean) => void): ViewState {
  return { zoom: partial?.zoom ?? zoom, showFormula: partial?.showFormula ?? showFormula, showGrid: partial?.showGrid ?? showGrid, setZoom: partial?.setZoom ?? setZoom, setShowFormula: partial?.setShowFormula ?? setShowFormula, setShowGrid: partial?.setShowGrid ?? setShowGrid };
}
function selectedRows(range: RangeAddress | null): number { return range === null ? 1 : range.r2 - range.r1 + 1; }
function selectedCols(range: RangeAddress | null): number { return range === null ? 1 : range.c2 - range.c1 + 1; }
function rangeName(range: RangeAddress | null): string { const r = range ?? Range.single(0, 0).toAddress(); return `${xy2expr(r.c1, r.r1)}:${xy2expr(r.c2, r.r2)}`; }
export function allSheetRange(): RangeAddress { return { r1: 0, c1: 0, r2: TOTAL_ROWS - 1, c2: TOTAL_COLS - 1 }; }
