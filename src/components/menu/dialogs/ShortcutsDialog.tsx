import { Modal, Table } from 'antd';
import type { FC } from 'react';

export interface ShortcutsDialogProps { readonly open: boolean; readonly onCancel: () => void }

const DATA = [
  ['保存', 'Ctrl/⌘+S'], ['查找', 'Ctrl/⌘+F'], ['替换', 'Ctrl/⌘+H'], ['全选', 'Ctrl/⌘+A'],
  ['撤销', 'Ctrl/⌘+Z'], ['重做', 'Ctrl/⌘+Y / Ctrl/⌘+Shift+Z'], ['剪切/复制/粘贴', 'Ctrl/⌘+X/C/V'],
  ['加粗/斜体/下划线', 'Ctrl/⌘+B/I/U'], ['缩放', 'Ctrl/⌘+0/+/-'], ['清除内容', 'Delete'],
].map(([name, shortcut], index) => ({ key: String(index), name, shortcut }));

export const ShortcutsDialog: FC<ShortcutsDialogProps> = ({ open, onCancel }) => <Modal title="快捷键列表" open={open} onCancel={onCancel} footer={null} width={640}>
  <Table dataSource={DATA} pagination={false} columns={[{ title: '功能', dataIndex: 'name' }, { title: '快捷键', dataIndex: 'shortcut' }]} size="small" />
</Modal>;
