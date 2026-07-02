import { Modal, Radio, Input } from 'antd';
import type { FC } from 'react';
import { useState } from 'react';
import type { ChartType } from '../../../charts/types';

export interface ChartDialogProps {
  readonly open: boolean;
  readonly onCancel: () => void;
  readonly onSubmit: (type: ChartType, title: string) => void;
}

export const ChartDialog: FC<ChartDialogProps> = ({ open, onCancel, onSubmit }) => {
  const [chartType, setChartType] = useState<ChartType>('bar');
  const [title, setTitle] = useState('');
  const handleOk = (): void => { onSubmit(chartType, title); setTitle(''); setChartType('bar'); };
  const handleCancel = (): void => { setTitle(''); setChartType('bar'); onCancel(); };
  return (
    <Modal title="插入图表" open={open} onCancel={handleCancel} onOk={handleOk} okText="插入" cancelText="取消">
      <div style={{ marginBottom: 16 }}>
        <div style={{ marginBottom: 8 }}>图表类型：</div>
        <Radio.Group value={chartType} onChange={(e) => setChartType(e.target.value as ChartType)}>
          <Radio value="bar">柱状图</Radio>
          <Radio value="line">折线图</Radio>
          <Radio value="pie">饼图</Radio>
        </Radio.Group>
      </div>
      <div>
        <div style={{ marginBottom: 8 }}>标题（可选）：</div>
        <Input placeholder="图表标题" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
    </Modal>
  );
};
