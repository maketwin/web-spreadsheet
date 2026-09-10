import { InputNumber, Modal, Radio } from 'antd';
import { useEffect, useRef, useState, type FC } from 'react';
import { createPortal } from 'react-dom';

export interface ContextMenuProps {
  readonly x: number;
  readonly y: number;
  readonly type: 'row' | 'column';
  readonly index: number;
  /** Number of selected rows/cols (Excel multi-select). */
  readonly count?: number;
  readonly onInsertRow?: (r: number, position: 'above' | 'below', count: number) => void;
  readonly onDeleteRow?: (r: number, count: number) => void;
  readonly onSetRowHeight?: (r: number, height: number) => void;
  readonly onInsertCol?: (c: number, position: 'left' | 'right', count: number) => void;
  readonly onDeleteCol?: (c: number, count: number) => void;
  readonly onSetColWidth?: (c: number, width: number) => void;
  readonly onCut?: () => void;
  readonly onCopy?: () => void;
  readonly onPaste?: () => void;
  readonly onClear?: () => void;
  readonly onClose: () => void;
}

type MenuEntry =
  | { readonly kind: 'item'; readonly key: string; readonly label: string; readonly shortcut?: string; readonly disabled?: boolean }
  | { readonly kind: 'divider'; readonly key: string };

export const HeaderContextMenu: FC<ContextMenuProps> = ({
  x, y, type, index, count = 1, onInsertRow, onDeleteRow, onSetRowHeight, onInsertCol, onDeleteCol, onSetColWidth, onCut, onCopy, onPaste, onClear, onClose,
}) => {
  const n = Math.max(1, count);
  const insertLabel = type === 'row'
    ? (n > 1 ? `插入 ${n} 行` : '插入')
    : (n > 1 ? `插入 ${n} 列` : '插入');
  const deleteLabel = type === 'row'
    ? (n > 1 ? `删除 ${n} 行` : '删除')
    : (n > 1 ? `删除 ${n} 列` : '删除');
  const items: MenuEntry[] = type === 'row'
    ? [
        { kind: 'item', key: 'cut', label: '剪切', shortcut: 'Ctrl+X' },
        { kind: 'item', key: 'copy', label: '复制', shortcut: 'Ctrl+C' },
        { kind: 'item', key: 'paste', label: '粘贴', shortcut: 'Ctrl+V' },
        { kind: 'divider', key: 'd0' },
        { kind: 'item', key: 'insertAbove', label: insertLabel },
        { kind: 'item', key: 'deleteRow', label: deleteLabel },
        { kind: 'item', key: 'clear', label: '清除内容' },
        { kind: 'divider', key: 'd1' },
        { kind: 'item', key: 'setHeight', label: '行高...' },
      ]
    : [
        { kind: 'item', key: 'cut', label: '剪切', shortcut: 'Ctrl+X' },
        { kind: 'item', key: 'copy', label: '复制', shortcut: 'Ctrl+C' },
        { kind: 'item', key: 'paste', label: '粘贴', shortcut: 'Ctrl+V' },
        { kind: 'divider', key: 'd0' },
        { kind: 'item', key: 'insertLeft', label: insertLabel },
        { kind: 'item', key: 'deleteCol', label: deleteLabel },
        { kind: 'item', key: 'clear', label: '清除内容' },
        { kind: 'divider', key: 'd1' },
        { kind: 'item', key: 'setWidth', label: '列宽...' },
      ];

  return (
    <ExcelContextMenu
      x={x}
      y={y}
      items={items}
      onClose={onClose}
      onClick={(key) => {
        if (key === 'cut') onCut?.();
        if (key === 'copy') onCopy?.();
        if (key === 'paste') onPaste?.();
        if (key === 'clear') onClear?.();
        if (key === 'insertAbove' && type === 'row') onInsertRow?.(index, 'above', n);
        if (key === 'deleteRow' && type === 'row') onDeleteRow?.(index, n);
        if (key === 'setHeight' && type === 'row') showRowHeightDialog(index, onSetRowHeight);
        if (key === 'insertLeft' && type === 'column') onInsertCol?.(index, 'left', n);
        if (key === 'deleteCol' && type === 'column') onDeleteCol?.(index, n);
        if (key === 'setWidth' && type === 'column') showColWidthDialog(index, onSetColWidth);
        onClose();
      }}
    />
  );
};

export interface CellContextMenuProps {
  readonly x: number;
  readonly y: number;
  readonly onCut: () => void;
  readonly onCopy: () => void;
  readonly onPaste: () => void;
  readonly onClear: () => void;
  readonly onInsertRow: () => void;
  readonly onInsertCol: () => void;
  readonly onDeleteRow: () => void;
  readonly onDeleteCol: () => void;
  readonly onNumberFormat: () => void;
  readonly onClose: () => void;
}

export const CellContextMenu: FC<CellContextMenuProps> = ({
  x, y, onCut, onCopy, onPaste, onClear, onInsertRow, onInsertCol, onDeleteRow, onDeleteCol, onNumberFormat, onClose,
}) => {
  const items: MenuEntry[] = [
    { kind: 'item', key: 'cut', label: '剪切', shortcut: 'Ctrl+X' },
    { kind: 'item', key: 'copy', label: '复制', shortcut: 'Ctrl+C' },
    { kind: 'item', key: 'paste', label: '粘贴', shortcut: 'Ctrl+V' },
    { kind: 'divider', key: 'd1' },
    { kind: 'item', key: 'insert', label: '插入...' },
    { kind: 'item', key: 'delete', label: '删除...' },
    { kind: 'item', key: 'clear', label: '清除内容' },
    { kind: 'divider', key: 'd2' },
    { kind: 'item', key: 'numberFormat', label: '设置单元格格式...' },
  ];

  return (
    <ExcelContextMenu
      x={x}
      y={y}
      items={items}
      onClose={onClose}
      onClick={(key) => {
        if (key === 'cut') onCut();
        else if (key === 'copy') onCopy();
        else if (key === 'paste') onPaste();
        else if (key === 'clear') onClear();
        else if (key === 'insert') showInsertDialog(onInsertRow, onInsertCol);
        else if (key === 'delete') showDeleteDialog(onDeleteRow, onDeleteCol);
        else if (key === 'numberFormat') onNumberFormat();
        onClose();
      }}
    />
  );
};

interface ExcelContextMenuProps {
  readonly x: number;
  readonly y: number;
  readonly items: readonly MenuEntry[];
  readonly onClick: (key: string) => void;
  readonly onClose: () => void;
}

const ExcelContextMenu: FC<ExcelContextMenuProps> = ({ x, y, items, onClick, onClose }) => {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (ev: MouseEvent): void => {
      const el = rootRef.current;
      if (el !== null && !el.contains(ev.target as Node)) onClose();
    };
    const onKey = (ev: KeyboardEvent): void => { if (ev.key === 'Escape') onClose(); };
    const timer = window.setTimeout(() => {
      window.addEventListener('mousedown', onPointerDown, true);
      window.addEventListener('keydown', onKey, true);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('mousedown', onPointerDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);

  const left = Math.min(x, Math.max(0, window.innerWidth - 240));
  const top = Math.min(y, Math.max(0, window.innerHeight - 280));

  return createPortal(
    <div ref={rootRef} className="ss-excel-ctx" role="menu" style={{ left, top }} onContextMenu={(e) => e.preventDefault()}>
      {items.map((entry) => (entry.kind === 'divider'
        ? <div key={entry.key} className="ss-excel-ctx__divider" role="separator" />
        : (
          <button
            key={entry.key}
            type="button"
            role="menuitem"
            className="ss-excel-ctx__item"
            disabled={entry.disabled === true}
            onClick={() => { if (entry.disabled !== true) onClick(entry.key); }}
          >
            <span className="ss-excel-ctx__label">{entry.label}</span>
            {entry.shortcut !== undefined ? <span className="ss-excel-ctx__shortcut">{entry.shortcut}</span> : null}
          </button>
        )))}
    </div>,
    document.body,
  );
};

function showInsertDialog(onInsertRow: () => void, onInsertCol: () => void): void {
  let choice: 'row' | 'col' = 'row';
  Modal.confirm({
    title: '插入',
    okText: '确定',
    cancelText: '取消',
    content: <InsertDeleteRadios mode="insert" onChange={(v) => { choice = v; }} />,
    onOk: () => { if (choice === 'row') onInsertRow(); else onInsertCol(); },
  });
}

function showDeleteDialog(onDeleteRow: () => void, onDeleteCol: () => void): void {
  let choice: 'row' | 'col' = 'row';
  Modal.confirm({
    title: '删除',
    okText: '确定',
    cancelText: '取消',
    content: <InsertDeleteRadios mode="delete" onChange={(v) => { choice = v; }} />,
    onOk: () => { if (choice === 'row') onDeleteRow(); else onDeleteCol(); },
  });
}

const InsertDeleteRadios: FC<{ readonly mode: 'insert' | 'delete'; readonly onChange: (v: 'row' | 'col') => void }> = ({ mode, onChange }) => {
  const [value, setValue] = useState<'row' | 'col'>('row');
  return (
    <Radio.Group
      value={value}
      onChange={(e) => { const next = e.target.value as 'row' | 'col'; setValue(next); onChange(next); }}
      style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      <Radio value="row">{mode === 'insert' ? '整行' : '整行'}</Radio>
      <Radio value="col">{mode === 'insert' ? '整列' : '整列'}</Radio>
    </Radio.Group>
  );
};

function showRowHeightDialog(r: number, onSet?: (r: number, h: number) => void): void {
  if (onSet === undefined) return;
  let height = 20;
  Modal.confirm({
    title: '行高',
    content: <HeightInput onChange={(v) => { height = v; }} defaultValue={20} />,
    okText: '确定',
    cancelText: '取消',
    onOk: () => { onSet(r, height); },
  });
}

function showColWidthDialog(c: number, onSet?: (c: number, w: number) => void): void {
  if (onSet === undefined) return;
  let width = 64;
  Modal.confirm({
    title: '列宽',
    content: <WidthInput onChange={(v) => { width = v; }} defaultValue={64} />,
    okText: '确定',
    cancelText: '取消',
    onOk: () => { onSet(c, width); },
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
    const scale = zoom / 100;
    const row = Math.floor((localY - 25 + scrollTop) / (25 * scale));
    return { type: 'row', r: Math.max(0, Math.min(row, 999)), x: clientX, y: clientY };
  }
  if (localY < 25 && localX >= 46) {
    const scale = zoom / 100;
    const col = Math.floor((localX - 46 + scrollLeft) / (100 * scale));
    return { type: 'column', c: Math.max(0, Math.min(col, 25)), x: clientX, y: clientY };
  }
  return null;
}
