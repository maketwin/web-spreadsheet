import { Button } from 'antd';
import type { FC } from 'react';

export interface BottomBarProps {
  sheets?: readonly string[];
  activeSheet?: string;
  onSheetChange?: (sheet: string) => void;
  onAddSheet?: () => void;
}

export const BottomBar: FC<BottomBarProps> = ({
  sheets = ['Sheet1'],
  activeSheet = 'Sheet1',
  onSheetChange,
  onAddSheet,
}) => (
  <div className="ss-bottom-bar" role="tablist" aria-label="Spreadsheet sheets">
    {sheets.map((sheet) => (
      <Button
        key={sheet}
        type={sheet === activeSheet ? 'primary' : 'default'}
        role="tab"
        aria-selected={sheet === activeSheet}
        onClick={() => onSheetChange?.(sheet)}
      >
        {sheet}
      </Button>
    ))}
    <Button onClick={onAddSheet} aria-label="Add sheet">
      +
    </Button>
  </div>
);
