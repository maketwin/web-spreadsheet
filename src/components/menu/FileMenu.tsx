import { Menu } from 'antd';
import type { FC } from 'react';
import { shortcutLabel } from './shortcutLabel';
import type { MenuActions } from './types';

export interface FileMenuProps { readonly actions: MenuActions }

export const FileMenu: FC<FileMenuProps> = ({ actions }) => <Menu selectable={false} onClick={onClick(actions)} items={[
  { key: 'file:new', label: '新建工作簿' },
  { key: 'file:open', label: '打开...' },
  { type: 'divider' },
  { key: 'file:save', label: shortcutLabel('保存', 'Ctrl+S') },
  { key: 'file:saveAs', label: shortcutLabel('另存为...', 'Ctrl+Shift+S') },
  { type: 'divider' },
  { key: 'file:import', label: '导入 xlsx/CSV' },
  { key: 'file:export', label: '导出 xlsx/JSON' },
  { type: 'divider' },
  { key: 'file:close', label: '关闭' },
]} />;

function onClick(actions: MenuActions): ({ key }: { key: string }) => void {
  return ({ key }) => actions.run(key);
}
