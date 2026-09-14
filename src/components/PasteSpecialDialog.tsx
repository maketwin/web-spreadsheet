import { Checkbox, Modal, Radio } from 'antd';
import { useEffect, useState, type FC } from 'react';

import { DEFAULT_PASTE_SPECIAL, type PasteMode, type PasteOperation, type PasteSpecialOptions } from '../clipboard/pasteSpecial';

export interface PasteSpecialDialogProps {
  readonly open: boolean;
  readonly onOk: (opts: PasteSpecialOptions) => void;
  readonly onCancel: () => void;
}

/** Excel Paste Special dialog (Ctrl+Alt+V): mode, operation, skip blanks, transpose. */
export const PasteSpecialDialog: FC<PasteSpecialDialogProps> = ({ open, onOk, onCancel }) => {
  const [mode, setMode] = useState<PasteMode>(DEFAULT_PASTE_SPECIAL.mode);
  const [operation, setOperation] = useState<PasteOperation>(DEFAULT_PASTE_SPECIAL.operation);
  const [skipBlanks, setSkipBlanks] = useState(DEFAULT_PASTE_SPECIAL.skipBlanks);
  const [transpose, setTranspose] = useState(DEFAULT_PASTE_SPECIAL.transpose);
  useEffect(() => {
    if (open) { setMode('all'); setOperation('none'); setSkipBlanks(false); setTranspose(false); }
  }, [open]);
  return (
    <Modal title="选择性粘贴" open={open} okText="确定" cancelText="取消" width={420}
      onOk={() => onOk({ mode, operation, skipBlanks, transpose })} onCancel={onCancel}>
      <div style={{ display: 'flex', gap: 24 }}>
        <div>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>粘贴</div>
          <Radio.Group value={mode} onChange={(e) => setMode(e.target.value as PasteMode)} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Radio value="all">全部</Radio>
            <Radio value="formulas">公式</Radio>
            <Radio value="values">值</Radio>
            <Radio value="formats">格式</Radio>
          </Radio.Group>
        </div>
        <div>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>运算</div>
          <Radio.Group value={operation} onChange={(e) => setOperation(e.target.value as PasteOperation)} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Radio value="none">无</Radio>
            <Radio value="add">加</Radio>
            <Radio value="subtract">减</Radio>
            <Radio value="multiply">乘</Radio>
            <Radio value="divide">除</Radio>
          </Radio.Group>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 24, marginTop: 16 }}>
        <Checkbox checked={skipBlanks} onChange={(e) => setSkipBlanks(e.target.checked)}>跳过空单元格</Checkbox>
        <Checkbox checked={transpose} onChange={(e) => setTranspose(e.target.checked)}>转置</Checkbox>
      </div>
    </Modal>
  );
};
