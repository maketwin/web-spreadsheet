import { Checkbox, Form, Modal, Radio, Space, Typography } from 'antd';
import type { FC } from 'react';
import type { SheetInfo } from '../../../store/Store';

export interface MoveOrCopySheetValues {
  readonly beforeSheetId: string | 'end';
  readonly createCopy: boolean;
}

export interface MoveOrCopySheetDialogProps {
  readonly open: boolean;
  readonly sheetId: string;
  readonly sheets: readonly SheetInfo[];
  readonly onCancel: () => void;
  readonly onSubmit: (values: MoveOrCopySheetValues) => void;
}

/** Excel 「移动或复制工作表」：选择插入位置 + 是否建立副本. */
export const MoveOrCopySheetDialog: FC<MoveOrCopySheetDialogProps> = ({
  open,
  sheetId,
  sheets,
  onCancel,
  onSubmit,
}) => {
  const [form] = Form.useForm<MoveOrCopySheetValues>();
  const current = sheets.find((s) => s.id === sheetId);
  const others = sheets; // Excel lists all sheets as "before" targets including self position semantics
  return (
    <Modal
      title="移动或复制工作表"
      open={open}
      onCancel={onCancel}
      onOk={() => { void form.validateFields().then(onSubmit); }}
      okText="确定"
      cancelText="取消"
      destroyOnClose
      afterOpenChange={(visible) => {
        if (visible) form.setFieldsValue({ beforeSheetId: 'end', createCopy: false });
      }}
    >
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
        将「{current?.name ?? ''}」移动到所选工作表之前，或勾选建立副本。
      </Typography.Paragraph>
      <Form form={form} layout="vertical" initialValues={{ beforeSheetId: 'end', createCopy: false }}>
        <Form.Item name="beforeSheetId" label="下列选定工作表之前" rules={[{ required: true }]}>
          <Radio.Group style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Space direction="vertical" size={4}>
              {others.map((s) => (
                <Radio key={s.id} value={s.id}>{s.name}</Radio>
              ))}
              <Radio value="end">（移到最后）</Radio>
            </Space>
          </Radio.Group>
        </Form.Item>
        <Form.Item name="createCopy" valuePropName="checked">
          <Checkbox>建立副本</Checkbox>
        </Form.Item>
      </Form>
    </Modal>
  );
};
