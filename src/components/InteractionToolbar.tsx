import { Button, ColorPicker, Divider, Dropdown, Form, Input, Modal, Select, Space, Switch, Tooltip, message } from 'antd';
import { DownOutlined, AlignCenterOutlined, AlignLeftOutlined, AlignRightOutlined, BgColorsOutlined, BoldOutlined, BorderBottomOutlined, BorderInnerOutlined, BorderLeftOutlined, BorderOuterOutlined, BorderRightOutlined, BorderTopOutlined, ClearOutlined, ColumnHeightOutlined, FontColorsOutlined, FormatPainterOutlined, ItalicOutlined, LockOutlined, SelectOutlined, UnderlineOutlined, StrikethroughOutlined, ZoomInOutlined, ZoomOutOutlined, TableOutlined, VerticalAlignTopOutlined, VerticalAlignMiddleOutlined, VerticalAlignBottomOutlined, MergeCellsOutlined } from '@ant-design/icons';
import type { Dispatch, FC, SetStateAction } from 'react';
import type { CommandManager } from '../commands/CommandManager';
import type { BorderPreset } from '../commands/impl/SetRangeBorder';
import { clearRange } from '../util/rangeValues';
import type { Store } from '../store/Store';
import type { Selection } from '../selection/Selection';
import type { Style } from '../types';
import { adjustDecimalPlaces } from '../format/decimalPlaces';
import { DEFAULT_FONT_SIZE } from '../util/defaults';
import { protectSheet, unprotectSheet, verifyPassword } from '../protection/SheetProtection';
import { isSingleMergeSelection, mergeSelection } from './mergeActions';
import { applyRangeBorder, applyShortcutStyle, growRowsToContent } from './spreadsheetActions';
import type { ViewState } from './keyboard';

const FONT_FAMILIES = [
  'Calibri',
  'Microsoft YaHei',
  'SimSun',
  'Arial',
  'Times New Roman',
  'Consolas',
  'Segoe UI',
] as const;

const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72] as const;

export const InteractionToolbar: FC<{ readonly selected: Selection | null; readonly store: Store; readonly cmdManager: CommandManager | undefined; readonly view: ViewState; readonly setView: Dispatch<SetStateAction<ViewState>>; readonly selectAll: () => void; readonly painting: boolean; readonly onTogglePainter: () => void; readonly onToggleProtection: () => void }> = ({ selected, store, cmdManager, view, setView, selectAll, painting, onTogglePainter, onToggleProtection }) => {
  const range = selected?.range;
  const current = activeCellStyle(store, selected);
  const style = (next: Partial<Style>): void => { if (range !== undefined) applyShortcutStyle(store, cmdManager, range, next); };
  const setZoom = (zoom: number): void => setView((currentView) => ({ ...currentView, zoom }));
  const fontFamily = current?.fontFamily ?? 'Calibri';
  const fontSize = current?.fontSize ?? DEFAULT_FONT_SIZE;
  const fontColor = current?.color ?? '#000000';
  const fillColor = current?.bgcolor ?? '#FFFFFF';
  const wrapping = current?.wrap === true;
  return <div className="ss-interaction-toolbar" role="toolbar" aria-label="Spreadsheet toolbar"
    // Excel: clicking the toolbar while editing keeps the edit session alive —
    // plain buttons must not steal focus from the cell editor.
    onMouseDown={(e) => { const t = e.target as HTMLElement; if (t.closest('button') !== null && t.closest('.ant-select, .ant-popover, .ant-dropdown, .ant-picker') === null) e.preventDefault(); }}>
    <Space size={4} wrap>
      <Tooltip title="全选"><Button size="small" icon={<SelectOutlined />} aria-label="Select all" onClick={selectAll} /></Tooltip>
      <Tooltip title="清除内容"><Button size="small" icon={<ClearOutlined />} aria-label="Clear contents" onClick={() => { if (range !== undefined) clearRange(store, cmdManager, range); }} /></Tooltip>
      <Divider type="vertical" />
      <Tooltip title={painting ? '退出格式刷' : '格式刷'}><Button size="small" type={painting ? 'primary' : 'default'} icon={<FormatPainterOutlined />} aria-label="Format painter" onClick={onTogglePainter} /></Tooltip>
      <Divider type="vertical" />
      <Select
        size="small"
        aria-label="Font family"
        style={{ width: 120 }}
        value={fontFamily}
        popupMatchSelectWidth={false}
        options={FONT_FAMILIES.map((value) => ({ value, label: value }))}
        onChange={(value) => style({ fontFamily: value })}
      />
      <Select
        size="small"
        aria-label="Font size"
        style={{ width: 64 }}
        value={fontSize}
        popupMatchSelectWidth={false}
        options={FONT_SIZES.map((value) => ({ value, label: String(value) }))}
        onChange={(value) => {
          style({ fontSize: value });
          if (range !== undefined) growRowsToContent(store, range);
        }}
      />
      <Tooltip title="加粗"><Button size="small" type={current?.bold === true ? 'primary' : 'default'} icon={<BoldOutlined />} aria-label="Bold" onClick={() => style({ bold: !(current?.bold === true) })} /></Tooltip>
      <Tooltip title="斜体"><Button size="small" type={current?.italic === true ? 'primary' : 'default'} icon={<ItalicOutlined />} aria-label="Italic" onClick={() => style({ italic: !(current?.italic === true) })} /></Tooltip>
      <Tooltip title="下划线"><Button size="small" type={current?.underline === true ? 'primary' : 'default'} icon={<UnderlineOutlined />} aria-label="Underline" onClick={() => style({ underline: !(current?.underline === true) })} /></Tooltip>
      <Tooltip title="删除线"><Button size="small" type={current?.strike === true ? 'primary' : 'default'} icon={<StrikethroughOutlined />} aria-label="Strikethrough" onClick={() => style({ strike: !(current?.strike === true) })} /></Tooltip>
      <Tooltip title="增加缩进"><Button size="small" aria-label="Increase indent" onClick={() => style({ indent: Math.min(15, (current?.indent ?? 0) + 1) })}>→|</Button></Tooltip>
      <Tooltip title="减少缩进"><Button size="small" aria-label="Decrease indent" onClick={() => style({ indent: Math.max(0, (current?.indent ?? 0) - 1) })}>|←</Button></Tooltip>
      <Tooltip title="增加小数位数"><Button size="small" className="ss-decimal-btn" aria-label="Increase decimal" onClick={() => { const next = adjustDecimalPlaces(current?.numberFormat, 1); if (next !== null) style({ numberFormat: next }); }}>.0→.00</Button></Tooltip>
      <Tooltip title="减少小数位数"><Button size="small" className="ss-decimal-btn" aria-label="Decrease decimal" onClick={() => { const next = adjustDecimalPlaces(current?.numberFormat, -1); if (next !== null) style({ numberFormat: next }); }}>.00→.0</Button></Tooltip>
      <Select
        size="small"
        aria-label="Text rotation"
        placeholder="旋转"
        style={{ width: 72 }}
        value={current?.textRotation ?? 0}
        options={[
          { value: 0, label: '0°' },
          { value: 45, label: '45°' },
          { value: 90, label: '90°' },
          { value: -45, label: '-45°' },
          { value: -90, label: '-90°' },
        ]}
        onChange={(v: number) => style({ textRotation: v })}
      />
      <Tooltip title="字体颜色">
        <ColorPicker
          size="small"
          value={fontColor}
          disabledAlpha
          arrow={false}
          onChange={(value) => style({ color: value.toHexString() })}
        >
          <Button size="small" aria-label="Font color" icon={<FontColorsOutlined />} style={{ color: fontColor }} />
        </ColorPicker>
      </Tooltip>
      <Tooltip title="单元格填充">
        <ColorPicker
          size="small"
          value={fillColor}
          disabledAlpha
          arrow={false}
          onChange={(value) => style({ bgcolor: value.toHexString() })}
        >
          <Button size="small" aria-label="Fill color" icon={<BgColorsOutlined />} style={{ color: fillColor === '#FFFFFF' || fillColor.toLowerCase() === '#fff' ? '#666' : fillColor }} />
        </ColorPicker>
      </Tooltip>
      <Divider type="vertical" />
      <Tooltip title="左对齐"><Button size="small" type={current?.align === 'left' ? 'primary' : 'default'} icon={<AlignLeftOutlined />} aria-label="Align left" onClick={() => style({ align: 'left' })} /></Tooltip>
      <Tooltip title="居中"><Button size="small" type={current?.align === 'center' ? 'primary' : 'default'} icon={<AlignCenterOutlined />} aria-label="Align center" onClick={() => style({ align: 'center' })} /></Tooltip>
      <Tooltip title="右对齐"><Button size="small" type={current?.align === 'right' ? 'primary' : 'default'} icon={<AlignRightOutlined />} aria-label="Align right" onClick={() => style({ align: 'right' })} /></Tooltip>
      <Divider type="vertical" />
      <Tooltip title="顶端对齐"><Button size="small" type={current?.valign === 'top' ? 'primary' : 'default'} icon={<VerticalAlignTopOutlined />} aria-label="Align top" onClick={() => style({ valign: 'top' })} /></Tooltip>
      <Tooltip title="垂直居中"><Button size="small" type={(current?.valign ?? 'middle') === 'middle' ? 'primary' : 'default'} icon={<VerticalAlignMiddleOutlined />} aria-label="Align middle" onClick={() => style({ valign: 'middle' })} /></Tooltip>
      <Tooltip title="底端对齐"><Button size="small" type={current?.valign === 'bottom' ? 'primary' : 'default'} icon={<VerticalAlignBottomOutlined />} aria-label="Align bottom" onClick={() => style({ valign: 'bottom' })} /></Tooltip>
      <Divider type="vertical" />
      <Dropdown.Button
        size="small"
        className="ss-merge-btn"
        type={isSingleMergeSelection(store, range ?? { r1: 0, c1: 0, r2: 0, c2: 0 }) && range !== undefined ? 'primary' : 'default'}
        icon={<DownOutlined />}
        aria-label="合并单元格"
        menu={{
          items: [
            { key: 'center', label: '合并后居中' },
            { key: 'across', label: '跨越合并' },
            { key: 'plain', label: '合并单元格' },
            { key: 'unmerge', label: '取消合并' },
          ],
          onClick: ({ key }) => { if (range !== undefined) mergeSelection(store, cmdManager, range, key as 'center' | 'across' | 'plain' | 'unmerge'); },
        }}
        onClick={() => { if (range !== undefined) mergeSelection(store, cmdManager, range, 'center'); }}
      ><MergeCellsOutlined /> 合并后居中</Dropdown.Button>
      <Divider type="vertical" />
      <Tooltip title="自动换行">
        <Button
          size="small"
          type={wrapping ? 'primary' : 'default'}
          className="ss-wrap-btn"
          aria-label="自动换行"
          aria-pressed={wrapping}
          icon={<ColumnHeightOutlined />}
          onClick={() => {
            const next = !wrapping;
            style({ wrap: next });
            if (next && range !== undefined) growRowsToContent(store, range);
          }}
        >自动换行</Button>
      </Tooltip>
      <Divider type="vertical" />
      <Dropdown trigger={['click']} menu={{
        items: [
          { key: 'all', icon: <TableOutlined />, label: '全部边框' },
          { key: 'outer', icon: <BorderOuterOutlined />, label: '外边框' },
          { key: 'thickOuter', icon: <BorderOuterOutlined />, label: '粗匣边框' },
          { key: 'inner', icon: <BorderInnerOutlined />, label: '内边框' },
          { type: 'divider' },
          { key: 'top', icon: <BorderTopOutlined />, label: '上边框' },
          { key: 'bottom', icon: <BorderBottomOutlined />, label: '下边框' },
          { key: 'left', icon: <BorderLeftOutlined />, label: '左边框' },
          { key: 'right', icon: <BorderRightOutlined />, label: '右边框' },
          { type: 'divider' },
          { key: 'none', icon: <ClearOutlined />, label: '无边框' },
        ],
        onClick: ({ key }) => { if (range === undefined) return; if (key === 'thickOuter') applyRangeBorder(store, cmdManager, range, 'outer', 'thick'); else applyRangeBorder(store, cmdManager, range, key as BorderPreset); },
      }}>
        <Tooltip title="边框"><Button size="small" icon={<TableOutlined />} aria-label="Borders" /></Tooltip>
      </Dropdown>
      <Divider type="vertical" />
      <Tooltip title={store.isSheetProtected() ? '取消保护' : '保护工作表'}><Button size="small" icon={<LockOutlined />} aria-label="Sheet protection" onClick={onToggleProtection} /></Tooltip>
      <Divider type="vertical" />
      <Tooltip title="缩小"><Button size="small" icon={<ZoomOutOutlined />} aria-label="Zoom out" onClick={() => setZoom(Math.max(50, view.zoom - 10))} /></Tooltip>
      <Select size="small" aria-label="Zoom level" value={view.zoom} popupMatchSelectWidth={false} onChange={setZoom} options={[50, 75, 100, 125, 150, 200].map((value) => ({ value, label: `${value}%` }))} />
      <Tooltip title="放大"><Button size="small" icon={<ZoomInOutlined />} aria-label="Zoom in" onClick={() => setZoom(Math.min(200, view.zoom + 10))} /></Tooltip>
      <Divider type="vertical" />
      <span className="ss-toolbar-toggle"><Switch size="small" checked={view.showFormula} onChange={(showFormula) => setView((currentView) => ({ ...currentView, showFormula }))} />公式</span>
      <span className="ss-toolbar-toggle"><Switch size="small" checked={view.showGrid} onChange={(showGrid) => setView((currentView) => ({ ...currentView, showGrid }))} />网格</span>
    </Space>
  </div>;
};

function activeCellStyle(store: Store, selected: Selection | null): Style | undefined {
  const cell = selected?.active;
  if (cell === undefined) return undefined;
  const data = store.getCell(cell.r, cell.c);
  if (data?.styleId === undefined) return undefined;
  return store.getStyle(data.styleId);
}

export const ProtectionModal: FC<{ readonly open: boolean; readonly onClose: () => void; readonly store: Store }> = ({ open, onClose, store }) => {
  const isProtected = store.isSheetProtected();
  const [form] = Form.useForm<{ password: string }>();
  const submit = (): void => {
    const pwd = form.getFieldValue('password') ?? '';
    if (isProtected) {
      const prot = store.getProtection();
      if (prot !== undefined && prot.protected && !verifyPassword(pwd, prot.passwordHash)) { message.error('密码错误'); return; }
      store.setProtection(unprotectSheet());
      message.success('已取消保护');
    } else {
      store.setProtection(protectSheet(pwd));
      message.success('工作表已保护');
    }
    form.resetFields();
    onClose();
  };
  return <Modal title={isProtected ? '取消保护工作表' : '保护工作表'} open={open} onCancel={onClose} onOk={submit} destroyOnHidden>
    <Form form={form} layout="vertical"><Form.Item name="password" label="密码"><Input.Password placeholder={isProtected ? '输入保护密码' : '设置保护密码'} /></Form.Item></Form>
  </Modal>;
};
