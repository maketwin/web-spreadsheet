import { Modal, Checkbox, Space } from 'antd';
import type { FC } from 'react';
import { useEffect, useState } from 'react';

export interface RemoveDuplicatesDialogProps {
  readonly open: boolean;
  readonly columnLabels: readonly string[];
  readonly onCancel: () => void;
  readonly onSubmit: (columns: readonly number[], hasHeader: boolean) => void;
}

export const RemoveDuplicatesDialog: FC<RemoveDuplicatesDialogProps> = ({
  open, columnLabels, onCancel, onSubmit,
}) => {
  const [selected, setSelected] = useState<number[]>([]);
  const [hasHeader, setHasHeader] = useState(true);

  useEffect(() => {
    if (!open) return;
    setSelected(columnLabels.map((_, i) => i));
    setHasHeader(true);
  }, [open, columnLabels]);

  return (
    <Modal
      title="删除重复项"
      open={open}
      onCancel={onCancel}
      onOk={() => onSubmit(selected, hasHeader)}
      okText="删除"
      cancelText="取消"
      okButtonProps={{ disabled: selected.length === 0 }}
      destroyOnHidden
      width={420}
    >
      <Checkbox checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} style={{ marginBottom: 12 }}>
        数据包含标题行
      </Checkbox>
      <div style={{ marginBottom: 8 }}>要检查的列：</div>
      <Checkbox.Group
        value={selected}
        onChange={(vals) => setSelected(vals as number[])}
        style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
      >
        <Space direction="vertical">
          {columnLabels.map((label, i) => (
            <Checkbox key={i} value={i}>{label}</Checkbox>
          ))}
        </Space>
      </Checkbox.Group>
    </Modal>
  );
};
