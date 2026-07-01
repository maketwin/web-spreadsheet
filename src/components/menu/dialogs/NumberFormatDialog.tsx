import { Form, Modal, Select } from 'antd';
import type { FC } from 'react';
import type { Style } from '../../../types';

export interface NumberFormatValues { readonly numberFormat: NonNullable<Style['numberFormat']> }
export interface NumberFormatDialogProps { readonly open: boolean; readonly onCancel: () => void; readonly onSubmit: (values: NumberFormatValues) => void }

const OPTIONS: Array<{ readonly label: string; readonly value: NumberFormatValues['numberFormat'] }> = [
  { label: '常规', value: 'general' }, { label: '数字', value: 'number' }, { label: '货币', value: 'currency' },
  { label: '百分比', value: 'percent' }, { label: '日期', value: 'date' }, { label: '时间', value: 'time' }, { label: '科学计数', value: 'scientific' },
];

export const NumberFormatDialog: FC<NumberFormatDialogProps> = ({ open, onCancel, onSubmit }) => {
  const [form] = Form.useForm<NumberFormatValues>();
  return <Modal title="数字格式" open={open} onCancel={onCancel} onOk={() => submit(form, onSubmit)}>
    <Form form={form} layout="vertical" initialValues={{ numberFormat: 'general' }}>
      <Form.Item name="numberFormat" label="格式"><Select options={OPTIONS} /></Form.Item>
    </Form>
  </Modal>;
};

function submit(form: ReturnType<typeof Form.useForm<NumberFormatValues>>[0], onSubmit: (values: NumberFormatValues) => void): void {
  void form.validateFields().then(onSubmit);
}
