import { Menu } from 'antd';
import type { FC } from 'react';
import type { MenuActions } from './types';

export interface ToolsMenuProps { readonly actions: MenuActions }

export const ToolsMenu: FC<ToolsMenuProps> = ({ actions }) => <Menu selectable={false} onClick={onClick(actions)} items={[
  { key: 'tools:macro', label: '宏...' },
  { key: 'tools:options', label: '选项...' },
  { key: 'tools:plugins', label: '插件管理...' },
]} />;

function onClick(actions: MenuActions): ({ key }: { key: string }) => void {
  return ({ key }) => actions.run(key);
}
