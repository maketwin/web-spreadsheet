import { Dropdown, InputNumber, Modal } from 'antd';
import type { MenuProps } from 'antd';
import { useState, type FC } from 'react';

export interface ContextMenuProps {
  readonly x: number;
  readonly y: number;
  readonly type: 'row' | 'column';
  readonly index: number;
  readonly onInsertRow?: (r: number, position: 'above' | 'below') => void;
  readonly onDeleteRow?: (r: number) => void;
  readonly onSetRowHeight?: (r: number, height: number) => void;
  readonly onInsertCol?: (c: number, position: 'left' | 'right') => void;
  readonly onDeleteCol?: (c: number) => void;
  readonly onSetColWidth?: (c: number, width: number) => void;
  readonly onClose: () => void;
}

export const HeaderContextMenu: FC<ContextMenuProps> = ({ x, y, type, index, onInsertRow, onDeleteRow, onSetRowHeight, onInsertCol, onDeleteCol, onSetColWidth, onClose }) => {
  const items = type === 'row' ? rowItems() : colItems();

  return <Dropdown
    open={true}
    trigger={['contextMenu']}
    menu={{ items, onClick: ({ key }) => handleAction(key, type, index, onInsertRow, onDeleteRow, onSetRowHeight, onInsertCol, onDeleteCol, onSetColWidth, onClose) }}
    onOpenChange={(visible) => { if (!visible) onClose(); }}
  >
    <div style={{ position: 'fixed', left: x, top: y, width: 0, height: 0 }} />
  </Dropdown>;
};

function rowItems(): NonNullable<MenuProps['items']> {
  return [
    { key: 'insertAbove', label: '在上方插入行' },
    { key: 'insertBelow', label: '在下方插入行' },
    { type: 'divider', key: 'd1' },
    { key: 'deleteRow', label: '删除行' },
    { type: 'divider', key: 'd2' },
    { key: 'setHeight', label: '设置行高...' },
  ];
}

function colItems(): NonNullable<MenuProps['items']> {
  return [
    { key: 'insertLeft', label: '在左侧插入列' },
    { key: 'insertRight', label: '在右侧插入列' },
    { type: 'divider', key: 'd1' },
    { key: 'deleteCol', label: '删除列' },
    { type: 'divider', key: 'd2' },
    { key: 'setWidth', label: '设置列宽...' },
  ];
}

function handleAction(
  key: string, type: 'row' | 'column', index: number,
  onInsertRow?: (r: number, position: 'above' | 'below') => void,
  onDeleteRow?: (r: number) => void,
  onSetRowHeight?: (r: number, height: number) => void,
  onInsertCol?: (c: number, position: 'left' | 'right') => void,
  onDeleteCol?: (c: number) => void,
  onSetColWidth?: (c: number, width: number) => void,
  onClose?: () => void,
): void {
  if (key === 'insertAbove' && type === 'row') onInsertRow?.(index, 'above');
  if (key === 'insertBelow' && type === 'row') onInsertRow?.(index, 'below');
  if (key === 'deleteRow' && type === 'row') onDeleteRow?.(index);
  if (key === 'setHeight' && type === 'row') showRowHeightDialog(index, onSetRowHeight);
  if (key === 'insertLeft' && type === 'column') onInsertCol?.(index, 'left');
  if (key === 'insertRight' && type === 'column') onInsertCol?.(index, 'right');
  if (key === 'deleteCol' && type === 'column') onDeleteCol?.(index);
  if (key === 'setWidth' && type === 'column') showColWidthDialog(index, onSetColWidth);
  onClose?.();
}

function showRowHeightDialog(r: number, onSet?: (r: number, h: number) => void): void {
  if (onSet === undefined) return;
  let height = 25;
  const onOk = (): void => { onSet(r, height); };
  Modal.confirm({
    title: '设置行高',
    content: <HeightInput onChange={(v) => { height = v; }} defaultValue={25} />,
    onOk,
  });
}

function showColWidthDialog(c: number, onSet?: (c: number, w: number) => void): void {
  if (onSet === undefined) return;
  let width = 100;
  const onOk = (): void => { onSet(c, width); };
  Modal.confirm({
    title: '设置列宽',
    content: <WidthInput onChange={(v) => { width = v; }} defaultValue={100} />,
    onOk,
  });
}

const HeightInput: FC<{ readonly onChange: (v: number) => void; readonly defaultValue: number }> = ({ onChange, defaultValue }) => {
  const [value, setValue] = useState(defaultValue);
  return <InputNumber value={value} min={10} max={500} onChange={(v) => { if (v !== null) { setValue(v); onChange(v); } }} />;
};

const WidthInput: FC<{ readonly onChange: (v: number) => void; readonly defaultValue: number }> = ({ onChange, defaultValue }) => {
  const [value, setValue] = useState(defaultValue);
  return <InputNumber value={value} min={30} max={500} onChange={(v) => { if (v !== null) { setValue(v); onChange(v); } }} />;
};

export function isHeaderRightClick(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
  scrollLeft: number,
  scrollTop: number,
  zoom: number,
): { type: 'row'; r: number; x: number; y: number } | { type: 'column'; c: number; x: number; y: number } | null {
  const rect = canvas.getBoundingClientRect();
  const localX = clientX - rect.left;
  const localY = clientY - rect.top;
  if (localX < 0 || localY < 0) return null;

  if (localX < 46 && localY >= 25) {
    // Row header right-click
    const scale = zoom / 100;
    const row = Math.floor((localY - 25 + scrollTop) / (25 * scale));
    return { type: 'row', r: Math.max(0, Math.min(row, 999)), x: clientX, y: clientY };
  }
  if (localY < 25 && localX >= 46) {
    // Column header right-click
    const scale = zoom / 100;
    const col = Math.floor((localX - 46 + scrollLeft) / (100 * scale));
    return { type: 'column', c: Math.max(0, Math.min(col, 25)), x: clientX, y: clientY };
  }
  return null;
}
