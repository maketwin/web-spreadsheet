import { Menu, Switch } from 'antd';
import type { FC } from 'react';
import { shortcutLabel } from './shortcutLabel';
import type { MenuActions, ViewState } from './types';

export interface ViewMenuProps { readonly actions: MenuActions; readonly view: ViewState }

export const ViewMenu: FC<ViewMenuProps> = ({ actions, view }) => <Menu selectable={false} onClick={onClick(actions)} items={[
  { key: 'view:zoom100', label: shortcutLabel('100%', 'Ctrl+0') },
  { key: 'view:zoom', label: '缩放级别...' },
  { key: 'view:zoomIn', label: shortcutLabel('放大', 'Ctrl++') },
  { key: 'view:zoomOut', label: shortcutLabel('缩小', 'Ctrl+-') },
  { type: 'divider' },
  { key: 'view:formula', label: <ToggleLabel text="显示公式" checked={view.showFormula} onChange={view.setShowFormula} /> },
  { key: 'view:grid', label: <ToggleLabel text="显示网格线" checked={view.showGrid} onChange={view.setShowGrid} /> },
  { type: 'divider' },
  { key: 'view:freeze', label: '冻结窗格' },
  { key: 'view:fitWidth', label: '适应窗口宽度' },
]} />;

const ToggleLabel: FC<{ readonly text: string; readonly checked: boolean; readonly onChange: (value: boolean) => void }> = ({ text, checked, onChange }) => (
  <span className="ss-menu-label"><span>{text}</span><Switch size="small" checked={checked} onChange={onChange} /></span>
);

function onClick(actions: MenuActions): ({ key }: { key: string }) => void {
  return ({ key }) => actions.run(key);
}
