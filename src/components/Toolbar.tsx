import { Button } from 'antd';
import type { FC } from 'react';

export interface ToolbarProps {
  onBold?: () => void;
  onItalic?: () => void;
  onUnderline?: () => void;
  onFontSize?: () => void;
  onAlign?: () => void;
  onToggleDark?: () => void;
}

export const Toolbar: FC<ToolbarProps> = ({
  onBold,
  onItalic,
  onUnderline,
  onFontSize,
  onAlign,
  onToggleDark,
}) => (
  <div className="ss-toolbar" role="toolbar" aria-label="Spreadsheet toolbar">
    <Button onClick={onBold} aria-label="Bold">
      <strong>B</strong>
    </Button>
    <Button onClick={onItalic} aria-label="Italic">
      <em>I</em>
    </Button>
    <Button onClick={onUnderline} aria-label="Underline">
      <u>U</u>
    </Button>
    <Button onClick={onFontSize}>Font Size</Button>
    <Button onClick={onAlign}>Align</Button>
    <Button onClick={onToggleDark}>Dark</Button>
  </div>
);
