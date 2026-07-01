import { Menu } from 'antd';
import type { FC } from 'react';
import { shortcutLabel } from './shortcutLabel';
import type { MenuActions } from './types';

export interface EditMenuProps { readonly actions: MenuActions }

export const EditMenu: FC<EditMenuProps> = ({ actions }) => <Menu selectable={false} onClick={onClick(actions)} items={[
  { key: 'edit:undo', label: shortcutLabel('撤销', 'Ctrl+Z') },
  { key: 'edit:redo', label: shortcutLabel('重做', 'Ctrl+Y') },
  { type: 'divider' },
  { key: 'edit:cut', label: shortcutLabel('剪切', 'Ctrl+X') },
  { key: 'edit:copy', label: shortcutLabel('复制', 'Ctrl+C') },
  { key: 'edit:paste', label: shortcutLabel('粘贴', 'Ctrl+V') },
  { type: 'divider' },
  { key: 'edit:selectAll', label: shortcutLabel('全选', 'Ctrl+A') },
  { key: 'edit:find', label: shortcutLabel('查找...', 'Ctrl+F') },
  { key: 'edit:replace', label: shortcutLabel('查找替换...', 'Ctrl+H') },
  { type: 'divider' },
  { key: 'edit:clear', label: shortcutLabel('清除内容', 'Delete') },
]} />;

function onClick(actions: MenuActions): ({ key }: { key: string }) => void {
  return ({ key }) => actions.run(key);
}
