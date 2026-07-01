import { Form, InputNumber, Modal, Radio } from 'antd';
import type { FC } from 'react';

export interface InsertColValues { readonly position: 'left' | 'right'; readonly count: number }
export interface InsertColDialogProps { readonly open: boolean; readonly onCancel: () => void; readonly onSubmit: (values: InsertColValues) => void }

export const InsertColDialog: FC<InsertColDialogProps> = ({ open, onCancel, onSubmit }) => {
  const [form] = Form.useForm<InsertColValues>();
  return <Modal title="插入列" open={open} onCancel={onCancel} onOk={() => submit(form, onSubmit)}>
    <Form form={form} layout="vertical" initialValues={{ position: 'left', count: 1 }}>
      <Form.Item name="position" label="位置"><Radio.Group options={[{ label: '左侧', value: 'left' }, { label: '右侧', value: 'right' }]} /></Form.Item>
      <Form.Item name="count" label="数量"><InputNumber min={1} max={50} /></Form.Item>
    </Form>
  </Modal>;
};

function submit(form: ReturnType<typeof Form.useForm<InsertColValues>>[0], onSubmit: (values: InsertColValues) => void): void {
  void form.validateFields().then(onSubmit);
}
