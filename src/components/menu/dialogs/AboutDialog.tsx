import { Modal, Typography } from 'antd';
import type { FC } from 'react';

export interface AboutDialogProps { readonly open: boolean; readonly onCancel: () => void }

export const AboutDialog: FC<AboutDialogProps> = ({ open, onCancel }) => <Modal title="关于 web-spreadsheet" open={open} onCancel={onCancel} footer={null}>
  <Typography.Paragraph>web-spreadsheet v1.0.0</Typography.Paragraph>
  <Typography.Paragraph>专业 TypeScript Canvas 表格 SDK，支持公式、剪贴板、多工作表和 Excel 级菜单。</Typography.Paragraph>
  <Typography.Link href="https://github.com/maketwin/web-spreadsheet" target="_blank">GitHub 文档</Typography.Link>
</Modal>;
