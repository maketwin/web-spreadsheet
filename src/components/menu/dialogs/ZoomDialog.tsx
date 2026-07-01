import { Form, InputNumber, Modal } from 'antd';
import type { FC } from 'react';

export interface ZoomValues { readonly zoom: number }
export interface ZoomDialogProps { readonly open: boolean; readonly zoom: number; readonly onCancel: () => void; readonly onSubmit: (values: ZoomValues) => void }

export const ZoomDialog: FC<ZoomDialogProps> = ({ open, zoom, onCancel, onSubmit }) => {
  const [form] = Form.useForm<ZoomValues>();
  return <Modal title="缩放" open={open} onCancel={onCancel} onOk={() => submit(form, onSubmit)}>
    <Form form={form} layout="vertical" initialValues={{ zoom }}>
      <Form.Item name="zoom" label="缩放比例"><InputNumber min={50} max={200} addonAfter="%" /></Form.Item>
    </Form>
  </Modal>;
};

function submit(form: ReturnType<typeof Form.useForm<ZoomValues>>[0], onSubmit: (values: ZoomValues) => void): void {
  void form.validateFields().then(onSubmit);
}
