import { Menu } from 'antd';
import type { FC } from 'react';
import type { MenuActions } from './types';

export interface InsertMenuProps { readonly actions: MenuActions }

export const InsertMenu: FC<InsertMenuProps> = ({ actions }) => <Menu selectable={false} onClick={onClick(actions)} items={[
  { key: 'insert:row', label: '插入行...' },
  { key: 'insert:col', label: '插入列...' },
  { type: 'divider' },
  { key: 'insert:deleteRow', label: '删除行' },
  { key: 'insert:deleteCol', label: '删除列' },
  { type: 'divider' },
  { key: 'insert:merge', label: '合并单元格' },
  { key: 'insert:unmerge', label: '取消合并' },
  { type: 'divider' },
  { key: 'insert:image', label: '插入图片...' },
  { key: 'insert:chart', label: '插入图表...' },
]} />;

function onClick(actions: MenuActions): ({ key }: { key: string }) => void {
  return ({ key }) => actions.run(key);
}
