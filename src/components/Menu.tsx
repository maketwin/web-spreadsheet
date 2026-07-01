import { Button } from 'antd';
import type { FC } from 'react';

export interface MenuProps {
  visible?: boolean;
  x?: number;
  y?: number;
  onCopy?: () => void;
  onPaste?: () => void;
  onDelete?: () => void;
}

export const Menu: FC<MenuProps> = ({ visible = true, x = 0, y = 0, onCopy, onPaste, onDelete }) => {
  if (!visible) return null;

  return (
    <div className="ss-menu" role="menu" style={{ left: x, top: y }}>
      <Button role="menuitem" onClick={onCopy}>
        Copy
      </Button>
      <Button role="menuitem" onClick={onPaste}>
        Paste
      </Button>
      <Button role="menuitem" onClick={onDelete}>
        Delete
      </Button>
    </div>
  );
};
