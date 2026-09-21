import { Modal, Form, Input, Button, Space } from 'antd';
import type { FC } from 'react';
import { useEffect } from 'react';

export interface HyperlinkDialogValues {
  readonly target: string;
  readonly text: string;
  readonly tooltip: string;
}

export interface HyperlinkDialogProps {
  readonly open: boolean;
  readonly initial?: Partial<HyperlinkDialogValues>;
  readonly onCancel: () => void;
  readonly onSubmit: (values: HyperlinkDialogValues) => void;
  readonly onRemove?: () => void;
  readonly canRemove?: boolean;
}

export const HyperlinkDialog: FC<HyperlinkDialogProps> = ({
  open, initial, onCancel, onSubmit, onRemove, canRemove,
}) => {
  const [form] = Form.useForm<HyperlinkDialogValues>();

  useEffect(() => {
    if (!open) return;
    form.setFieldsValue({
      target: initial?.target ?? 'https://',
      text: initial?.text ?? '',
      tooltip: initial?.tooltip ?? '',
    });
  }, [open, initial, form]);

  const handleOk = (): void => {
    form.validateFields().then((values) => {
      onSubmit({
        target: values.target.trim(),
        text: (values.text ?? '').trim(),
        tooltip: (values.tooltip ?? '').trim(),
      });
      form.resetFields();
    }).catch(() => undefined);
  };

  return (
    <Modal
      title="插入超链接"
      open={open}
      onCancel={onCancel}
      destroyOnHidden
      width={480}
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>
            {canRemove === true ? (
              <Button danger onClick={() => onRemove?.()}>删除链接</Button>
            ) : null}
          </span>
          <Space>
            <Button onClick={onCancel}>取消</Button>
            <Button type="primary" onClick={handleOk}>确定</Button>
          </Space>
        </div>
      }
    >
      <Form form={form} layout="vertical">
        <Form.Item name="text" label="要显示的文字">
          <Input placeholder="单元格显示文本" />
        </Form.Item>
        <Form.Item
          name="target"
          label="地址"
          rules={[{ required: true, message: '请输入链接地址或 A1 引用' }]}
          extra="http(s)://、mailto:、A1 或 Sheet1!A1"
        >
          <Input placeholder="https://example.com" />
        </Form.Item>
        <Form.Item name="tooltip" label="屏幕提示">
          <Input placeholder="可选" />
        </Form.Item>
      </Form>
    </Modal>
  );
};
