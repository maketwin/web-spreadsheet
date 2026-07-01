import { Button } from 'antd';
import type { FC, MouseEvent } from 'react';
import type { SheetInfo } from '../store/Store';

export interface BottomBarProps {
  readonly sheets?: readonly (SheetInfo | string)[];
  readonly activeSheet?: string;
  readonly activeSheetId?: string;
  readonly onSheetChange?: (sheetId: string) => void;
  readonly onAddSheet?: () => void;
  readonly onRenameSheet?: (sheetId: string) => void;
  readonly onDeleteSheet?: (sheetId: string) => void;
}

export const BottomBar: FC<BottomBarProps> = ({
  sheets = ['Sheet1'],
  activeSheet = 'Sheet1',
  activeSheetId,
  onSheetChange,
  onAddSheet,
  onRenameSheet,
  onDeleteSheet,
}) => (
  <div className="ss-bottom-bar" role="tablist" aria-label="Spreadsheet sheets">
    {sheets.map((sheet) => {
      const info = sheetInfo(sheet);
      const active = activeSheetId === undefined ? info.name === activeSheet : info.id === activeSheetId;
      return (
        <Button
          key={info.id}
          type={active ? 'primary' : 'default'}
          role="tab"
          aria-selected={active}
          onClick={() => onSheetChange?.(info.id)}
          onDoubleClick={() => onRenameSheet?.(info.id)}
          onContextMenu={(event) => handleContextMenu(event, info.id, onDeleteSheet)}
        >
          {info.name}
        </Button>
      );
    })}
    <Button onClick={onAddSheet} aria-label="Add sheet">
      +
    </Button>
  </div>
);

function sheetInfo(sheet: SheetInfo | string): SheetInfo {
  if (typeof sheet === 'string') return { id: sheet, name: sheet };
  return sheet;
}

function handleContextMenu(event: MouseEvent<HTMLElement>, id: string, onDeleteSheet: ((sheetId: string) => void) | undefined): void {
  if (onDeleteSheet === undefined) return;
  event.preventDefault();
  onDeleteSheet(id);
}
