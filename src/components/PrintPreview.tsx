import { Button, Modal } from 'antd';
import { PrinterOutlined } from '@ant-design/icons';
import type { FC } from 'react';

export interface PrintPreviewProps {
  readonly open: boolean;
  readonly onCancel: () => void;
}

export const PrintPreview: FC<PrintPreviewProps> = ({ open, onCancel }) => {
  const handlePrint = (): void => {
    window.print();
  };

  return <Modal title="打印预览" open={open} onCancel={onCancel}
    footer={[
      <Button key="cancel" onClick={onCancel}>取消</Button>,
      <Button key="pdf" onClick={handlePrint}>导出 PDF</Button>,
      <Button key="print" type="primary" icon={<PrinterOutlined />} onClick={handlePrint}>打印</Button>,
    ]} width={600}>
    <div style={{ padding: '16px 0' }}>
      <p style={{ color: 'var(--ss-text-light)', textAlign: 'center', margin: '24px 0' }}>
        点击「打印」将调用浏览器打印对话框。<br />
        在打印对话框中选择「另存为 PDF」即可导出 PDF 文件。
      </p>
      <div style={{
        border: '1px solid var(--ss-border)', borderRadius: 8, padding: 16,
        background: 'white', minHeight: 200, textAlign: 'center',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--ss-text-light)',
      }}>
        <PrinterOutlined style={{ fontSize: 48, marginBottom: 12 }} />
        <span>打印预览（当前表格内容）</span>
      </div>
    </div>
  </Modal>;
};
