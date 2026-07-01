import { Form, InputNumber, Modal, Radio } from 'antd';
import type { FC } from 'react';

export interface InsertRowValues { readonly position: 'above' | 'below'; readonly count: number }
export interface InsertRowDialogProps { readonly open: boolean; readonly onCancel: () => void; readonly onSubmit: (values: InsertRowValues) => void }

export const InsertRowDialog: FC<InsertRowDialogProps> = ({ open, onCancel, onSubmit }) => {
  const [form] = Form.useForm<InsertRowValues>();
  return <Modal title="插入行" open={open} onCancel={onCancel} onOk={() => submit(form, onSubmit)}>
    <Form form={form} layout="vertical" initialValues={{ position: 'above', count: 1 }}>
      <Form.Item name="position" label="位置"><Radio.Group options={[{ label: '上方', value: 'above' }, { label: '下方', value: 'below' }]} /></Form.Item>
      <Form.Item name="count" label="数量"><InputNumber min={1} max={100} /></Form.Item>
    </Form>
  </Modal>;
};

function submit(form: ReturnType<typeof Form.useForm<InsertRowValues>>[0], onSubmit: (values: InsertRowValues) => void): void {
  void form.validateFields().then(onSubmit);
}
