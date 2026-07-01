import { ColorPicker, InputNumber, Menu, Popover, Select, Space } from 'antd';
import type { Color } from 'antd/es/color-picker';
import type { FC } from 'react';
import { shortcutLabel } from './shortcutLabel';
import type { MenuActions } from './types';
import type { Style } from '../../types';

export interface FormatMenuProps { readonly actions: MenuActions }

export const FormatMenu: FC<FormatMenuProps> = ({ actions }) => <Menu selectable={false} onClick={onClick(actions)} items={[
  { key: 'format:font', label: <Popover trigger="click" content={<FontPanel actions={actions} />}>字体...</Popover> },
  { key: 'format:size', label: <Popover trigger="click" content={<SizePanel actions={actions} />}>字号...</Popover> },
  { type: 'divider' },
  { key: 'format:bold', label: shortcutLabel('加粗', 'Ctrl+B') },
  { key: 'format:italic', label: shortcutLabel('斜体', 'Ctrl+I') },
  { key: 'format:underline', label: shortcutLabel('下划线', 'Ctrl+U') },
  { type: 'divider' },
  { key: 'format:color', label: <ColorPanel title="字体颜色" onChange={(color) => actions.applyStyle({ color })} /> },
  { key: 'format:bgcolor', label: <ColorPanel title="背景颜色" onChange={(bgcolor) => actions.applyStyle({ bgcolor })} /> },
  { type: 'divider' },
  { key: 'format:number', label: '数字格式...' },
  { key: 'format:align', label: '对齐', children: [
    { key: 'format:align:left', label: '左对齐' },
    { key: 'format:align:center', label: '居中' },
    { key: 'format:align:right', label: '右对齐' },
  ] },
  { key: 'format:wrap', label: '自动换行' },
]} />;

const FONT_OPTIONS = ['Arial', 'Calibri', 'Microsoft YaHei', 'PingFang SC', 'Times New Roman'].map((value) => ({ value, label: value }));

const FontPanel: FC<FormatMenuProps> = ({ actions }) => <Select style={{ width: 180 }} options={FONT_OPTIONS} defaultValue="Arial" onChange={(fontFamily: string) => actions.applyStyle({ fontFamily })} />;
const SizePanel: FC<FormatMenuProps> = ({ actions }) => <InputNumber min={8} max={72} defaultValue={14} onChange={(fontSize) => applySize(actions, fontSize)} />;

const ColorPanel: FC<{ readonly title: string; readonly onChange: (color: string) => void }> = ({ title, onChange }) => (
  <Space><span>{title}</span><ColorPicker onChangeComplete={(color: Color) => onChange(color.toHexString())} /></Space>
);

function applySize(actions: MenuActions, fontSize: number | null): void {
  if (fontSize !== null) actions.applyStyle({ fontSize });
}

function onClick(actions: MenuActions): ({ key }: { key: string }) => void {
  return ({ key }) => { if (!String(key).startsWith('format:font') && !String(key).startsWith('format:size')) actions.run(key); };
}

export type FormatStyle = Partial<Style>;
