import { Modal, Radio, Input, InputNumber } from 'antd';
import type { FC } from 'react';
import { useState } from 'react';
import type { ValidationType } from '../../../validation/types';

export interface DataValidationDialogProps {
  readonly open: boolean;
  readonly onCancel: () => void;
  readonly onSubmit: (type: ValidationType, config: ValidationConfig) => void;
}

export interface ValidationConfig {
  readonly listValues?: string;
  readonly min?: number;
  readonly max?: number;
  readonly minDate?: string;
  readonly maxDate?: string;
}

export const DataValidationDialog: FC<DataValidationDialogProps> = ({ open, onCancel, onSubmit }) => {
  const [vtype, setVtype] = useState<ValidationType>('list');
  const [listValues, setListValues] = useState('');
  const [min, setMin] = useState(0);
  const [max, setMax] = useState(100);
  const [minDate, setMinDate] = useState('2020-01-01');
  const [maxDate, setMaxDate] = useState('2030-12-31');
  const handleOk = (): void => {
    onSubmit(vtype, { listValues, min, max, minDate, maxDate });
    reset();
  };
  const handleCancel = (): void => { reset(); onCancel(); };
  const reset = (): void => { setVtype('list'); setListValues(''); };
  return (
    <Modal title="数据验证" open={open} onCancel={handleCancel} onOk={handleOk} okText="确定" cancelText="取消">
      <div style={{ marginBottom: 16 }}>
        <div style={{ marginBottom: 8 }}>验证类型：</div>
        <Radio.Group value={vtype} onChange={(e) => setVtype(e.target.value as ValidationType)}>
          <Radio value="list">下拉列表</Radio>
          <Radio value="integer">整数范围</Radio>
          <Radio value="date">日期范围</Radio>
        </Radio.Group>
      </div>
      {vtype === 'list' && (
        <div><div style={{ marginBottom: 8 }}>允许值（逗号分隔）：</div>
          <Input placeholder="值1,值2,值3" value={listValues} onChange={(e) => setListValues(e.target.value)} /></div>
      )}
      {vtype === 'integer' && (
        <div style={{ display: 'flex', gap: 16 }}>
          <div><div style={{ marginBottom: 8 }}>最小值：</div><InputNumber value={min} onChange={(v) => setMin(v ?? 0)} /></div>
          <div><div style={{ marginBottom: 8 }}>最大值：</div><InputNumber value={max} onChange={(v) => setMax(v ?? 100)} /></div>
        </div>
      )}
      {vtype === 'date' && (
        <div style={{ display: 'flex', gap: 16 }}>
          <div><div style={{ marginBottom: 8 }}>最早日期：</div><Input type="date" value={minDate} onChange={(e) => setMinDate(e.target.value)} /></div>
          <div><div style={{ marginBottom: 8 }}>最晚日期：</div><Input type="date" value={maxDate} onChange={(e) => setMaxDate(e.target.value)} /></div>
        </div>
      )}
    </Modal>
  );
};
