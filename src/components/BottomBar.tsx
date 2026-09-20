import type { CSSProperties, FC, DragEvent } from 'react';
import { useEffect, useState } from 'react';
import type { SheetInfo } from '../store/Store';

export interface BottomBarProps {
  readonly sheets?: readonly (SheetInfo | string)[];
  readonly activeSheet?: string;
  readonly activeSheetId?: string;
  readonly onSheetChange?: (sheetId: string) => void;
  readonly onAddSheet?: () => void;
  readonly onRenameSheet?: (sheetId: string) => void;
  readonly onDeleteSheet?: (sheetId: string) => void;
  readonly onMoveSheet?: (sheetId: string, toIndex: number) => void;
  readonly onSheetColor?: (sheetId: string, color: string | undefined) => void;
  readonly onMoveOrCopySheet?: (sheetId: string) => void;
}

interface SheetMenuState {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}

const TAB_COLORS = ['#217346', '#5b9bd5', '#ed7d31', '#a5a5a5', '#ffc000', '#70ad47', '#7030a0'] as const;

const menuStyle: CSSProperties = {
  position: 'fixed',
  zIndex: 1000,
  margin: 0,
  padding: '4px 0',
  listStyle: 'none',
  background: '#fff',
  border: '1px solid #d0d0d0',
  boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
  minWidth: 140,
};

const menuItemBtnStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  border: 'none',
  background: 'transparent',
  padding: '6px 12px',
  cursor: 'pointer',
  font: 'inherit',
};

export const BottomBar: FC<BottomBarProps> = ({
  sheets = ['Sheet1'],
  activeSheet = 'Sheet1',
  activeSheetId,
  onSheetChange,
  onAddSheet,
  onRenameSheet,
  onDeleteSheet,
  onMoveSheet,
  onSheetColor,
  onMoveOrCopySheet,
}) => {
  const [menu, setMenu] = useState<SheetMenuState | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  useEffect(() => {
    if (menu === null) return undefined;
    const close = (): void => setMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [menu]);

  const infos = sheets.map(sheetInfo);

  return (
    <div className="ss-bottom-bar" role="tablist" aria-label="Spreadsheet sheets" style={{ position: 'sticky', bottom: 0 }}>
      {infos.map((info, index) => {
        const active = activeSheetId === undefined ? info.name === activeSheet : info.id === activeSheetId;
        const tabStyle: CSSProperties | undefined = info.color === undefined
          ? undefined
          : { boxShadow: `inset 0 -3px 0 ${info.color}` };
        return (
          <button
            key={info.id}
            type="button"
            className={`ss-sheet-tab${active ? ' ss-sheet-tab--active' : ''}${dragId === info.id ? ' ss-sheet-tab--dragging' : ''}`}
            role="tab"
            aria-selected={active}
            draggable={onMoveSheet !== undefined}
            style={tabStyle}
            onClick={() => onSheetChange?.(info.id)}
            onDoubleClick={() => onRenameSheet?.(info.id)}
            onContextMenu={(event) => {
              event.preventDefault();
              setMenu({ id: info.id, x: event.clientX, y: event.clientY });
            }}
            onDragStart={(event: DragEvent<HTMLButtonElement>) => {
              setDragId(info.id);
              event.dataTransfer.setData('text/plain', info.id);
              event.dataTransfer.effectAllowed = 'move';
            }}
            onDragEnd={() => setDragId(null)}
            onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }}
            onDrop={(event) => {
              event.preventDefault();
              const fromId = event.dataTransfer.getData('text/plain') || dragId;
              setDragId(null);
              if (fromId === null || fromId === '') return;
              onMoveSheet?.(fromId, index);
            }}
          >
            {info.name}
          </button>
        );
      })}
      <button type="button" className="ss-sheet-add" onClick={onAddSheet} aria-label="Add sheet">
        +
      </button>
      {menu !== null && (
        <ul
          className="ss-sheet-tab-menu"
          role="menu"
          style={{ ...menuStyle, left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <li role="menuitem">
            <button type="button" style={menuItemBtnStyle} onClick={() => { onRenameSheet?.(menu.id); setMenu(null); }}>
              重命名
            </button>
          </li>
          <li role="menuitem">
            <button type="button" style={menuItemBtnStyle} onClick={() => { onDeleteSheet?.(menu.id); setMenu(null); }}>
              删除
            </button>
          </li>
          <li role="menuitem">
            <button type="button" style={menuItemBtnStyle} onClick={() => { onMoveOrCopySheet?.(menu.id); setMenu(null); }}>
              移动或复制…
            </button>
          </li>
          <li role="separator" style={{ height: 1, background: '#e0e0e0', margin: '4px 0' }} />
          <li role="menuitem" style={{ padding: '4px 12px' }}>
            <span style={{ fontSize: 12, color: '#666' }}>标签颜色</span>
            <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
              {TAB_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  aria-label={`Sheet color ${color}`}
                  title={color}
                  style={{ width: 16, height: 16, borderRadius: 2, border: '1px solid #ccc', background: color, cursor: 'pointer', padding: 0 }}
                  onClick={() => { onSheetColor?.(menu.id, color); setMenu(null); }}
                />
              ))}
              <button
                type="button"
                aria-label="Clear sheet color"
                style={{ ...menuItemBtnStyle, padding: '0 4px', width: 'auto' }}
                onClick={() => { onSheetColor?.(menu.id, undefined); setMenu(null); }}
              >
                无
              </button>
            </div>
          </li>
        </ul>
      )}
    </div>
  );
};

function sheetInfo(sheet: SheetInfo | string): SheetInfo {
  if (typeof sheet === 'string') return { id: sheet, name: sheet };
  return sheet;
}
