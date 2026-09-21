import type { FC } from 'react';
import { Form, Input, Modal } from 'antd';
import type { CellValueOperator } from '../../../conditional/ConditionalRule';

export interface CfHighlightDialogProps {
  readonly open: boolean;
  readonly operator: CellValueOperator;
  readonly onCancel: () => void;
  readonly onSubmit: (value: string, value2?: string) => void;
}

const TITLES: Partial<Record<CellValueOperator, string>> = { gt: '大于', lt: '小于', between: '介于', eq: '等于' };

/** Excel 条件格式 → 突出显示单元格规则（大于/小于/介于/等于）的快捷向导。 */
export const CfHighlightDialog: FC<CfHighlightDialogProps> = ({ open, operator, onCancel, onSubmit }) => {
  const [form] = Form.useForm<{ value: string; value2?: string }>();
  const isBetween = operator === 'between';
  const handleOk = (): void => {
    form.validateFields().then((values) => {
      onSubmit(values.value.trim(), values.value2?.trim());
      form.resetFields();
    }).catch(() => { /* validation error stays in the dialog */ });
  };
  return <Modal title={`突出显示单元格规则 — ${TITLES[operator] ?? operator}`} open={open} onCancel={onCancel} onOk={handleOk} okText="确定" cancelText="取消" destroyOnHidden width={400}>
    <Form form={form} layout="vertical" initialValues={{ value: '' }}>
      <Form.Item name="value" label={isBetween ? '最小值' : '值'} rules={[{ required: true, message: '请输入值' }]}>
        <Input autoFocus placeholder={isBetween ? '如 10' : '如 100'} />
      </Form.Item>
      {isBetween && <Form.Item name="value2" label="最大值" rules={[{ required: true, message: '请输入最大值' }]}>
        <Input placeholder="如 100" />
      </Form.Item>}
      <div style={{ color: '#888' }}>命中的单元格将填充浅红色（与 Excel 默认样式一致）。</div>
    </Form>
  </Modal>;
};
