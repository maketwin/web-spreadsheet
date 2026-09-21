import { Modal, Radio, Input, Checkbox } from 'antd';
import type { FC } from 'react';
import { useEffect, useState } from 'react';
import type { TextToColumnsDelimiter, TextToColumnsOptions } from '../../../data/textToColumns';

export interface TextToColumnsDialogProps {
  readonly open: boolean;
  readonly onCancel: () => void;
  readonly onSubmit: (options: TextToColumnsOptions) => void;
}

export const TextToColumnsDialog: FC<TextToColumnsDialogProps> = ({ open, onCancel, onSubmit }) => {
  const [delimiter, setDelimiter] = useState<TextToColumnsDelimiter>('comma');
  const [custom, setCustom] = useState('|');
  const [consecutiveAsOne, setConsecutiveAsOne] = useState(true);

  useEffect(() => {
    if (!open) return;
    setDelimiter('comma');
    setCustom('|');
    setConsecutiveAsOne(true);
  }, [open]);

  return (
    <Modal
      title="分列"
      open={open}
      onCancel={onCancel}
      onOk={() => onSubmit({
        delimiter,
        ...(delimiter === 'custom' ? { custom } : {}),
        consecutiveAsOne,
      })}
      okText="完成"
      cancelText="取消"
      destroyOnHidden
      width={420}
    >
      <div style={{ marginBottom: 8 }}>分隔符：</div>
      <Radio.Group value={delimiter} onChange={(e) => setDelimiter(e.target.value as TextToColumnsDelimiter)}>
        <Radio value="tab">Tab</Radio>
        <Radio value="semicolon">分号</Radio>
        <Radio value="comma">逗号</Radio>
        <Radio value="space">空格</Radio>
        <Radio value="custom">其他</Radio>
      </Radio.Group>
      {delimiter === 'custom' && (
        <Input
          style={{ marginTop: 12, width: 120 }}
          value={custom}
          maxLength={4}
          onChange={(e) => setCustom(e.target.value)}
          placeholder="自定义"
        />
      )}
      <div style={{ marginTop: 16 }}>
        <Checkbox checked={consecutiveAsOne} onChange={(e) => setConsecutiveAsOne(e.target.checked)}>
          连续分隔符视为单个
        </Checkbox>
      </div>
    </Modal>
  );
};
