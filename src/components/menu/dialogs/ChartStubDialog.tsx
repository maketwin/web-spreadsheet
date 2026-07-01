import { Modal } from 'antd';
import type { FC } from 'react';

export interface ChartStubDialogProps {
  readonly open: boolean;
  readonly onCancel: () => void;
}

export const ChartStubDialog: FC<ChartStubDialogProps> = ({ open, onCancel }) => (
  <Modal title="图表" open={open} onCancel={onCancel} onOk={onCancel} okText="知道了">
    <p>图表功能开发中，敬请期待！</p>
  </Modal>
);
