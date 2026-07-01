import { Menu } from 'antd';
import type { FC } from 'react';
import type { MenuActions } from './types';

export interface HelpMenuProps { readonly actions: MenuActions }

export const HelpMenu: FC<HelpMenuProps> = ({ actions }) => <Menu selectable={false} onClick={onClick(actions)} items={[
  { key: 'help:about', label: '关于 web-spreadsheet' },
  { key: 'help:docs', label: '文档' },
  { key: 'help:shortcuts', label: '快捷键列表' },
]} />;

function onClick(actions: MenuActions): ({ key }: { key: string }) => void {
  return ({ key }) => actions.run(key);
}
