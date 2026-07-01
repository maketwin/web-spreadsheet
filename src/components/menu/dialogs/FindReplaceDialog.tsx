import { Form, Input, Modal } from 'antd';
import type { FC } from 'react';

export interface FindReplaceValues { readonly find: string; readonly replace?: string }
export interface FindReplaceDialogProps {
  readonly open: boolean;
  readonly replaceMode?: boolean;
  readonly onCancel: () => void;
  readonly onSubmit: (values: FindReplaceValues) => void;
}

export const FindReplaceDialog: FC<FindReplaceDialogProps> = ({ open, replaceMode = false, onCancel, onSubmit }) => {
  const [form] = Form.useForm<FindReplaceValues>();
  return <Modal title={replaceMode ? '查找和替换' : '查找'} open={open} onCancel={onCancel} onOk={() => submit(form, onSubmit)}>
    <Form form={form} layout="vertical" initialValues={{ find: '', replace: '' }}>
      <Form.Item name="find" label="查找内容" rules={[{ required: true, message: '请输入查找内容' }]}><Input autoFocus /></Form.Item>
      {replaceMode && <Form.Item name="replace" label="替换为"><Input /></Form.Item>}
    </Form>
  </Modal>;
};

function submit(form: ReturnType<typeof Form.useForm<FindReplaceValues>>[0], onSubmit: (values: FindReplaceValues) => void): void {
  void form.validateFields().then(onSubmit);
}
