import { Form, Input, Modal, Radio } from 'antd';
import type { FC } from 'react';
import type { SparklineType } from '../../../sparkline/types';

export interface SparklineConfig {
  readonly type: SparklineType;
  readonly range: string;
}

export interface SparklineDialogProps {
  readonly open: boolean;
  readonly onCancel: () => void;
  readonly onSubmit: (config: SparklineConfig) => void;
}

export const SparklineDialog: FC<SparklineDialogProps> = ({ open, onCancel, onSubmit }) => {
  const [form] = Form.useForm<{ type: SparklineType; range: string }>();
  const handleOk = (): void => {
    const values = form.getFieldsValue();
    onSubmit({ type: values.type, range: values.range });
    form.resetFields();
  };
  return <Modal title="插入迷你图" open={open} onCancel={onCancel} onOk={handleOk} destroyOnHidden>
    <Form form={form} layout="vertical" initialValues={{ type: 'line' as SparklineType, range: '' }}>
      <Form.Item name="type" label="类型"><Radio.Group>
        <Radio value="line">折线</Radio>
        <Radio value="bar">柱形</Radio>
        <Radio value="winloss">盈亏</Radio>
      </Radio.Group></Form.Item>
      <Form.Item name="range" label="数据范围" rules={[{ required: true, message: '请输入数据范围' }]}>
        <Input placeholder="A1:A5" />
      </Form.Item>
    </Form>
  </Modal>;
};
