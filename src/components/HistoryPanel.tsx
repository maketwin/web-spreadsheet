import { List, Modal } from 'antd';
import type { FC } from 'react';
import type { CommandManager, HistoryEntry } from '../commands/CommandManager';

export interface HistoryPanelProps {
  readonly open: boolean;
  readonly onCancel: () => void;
  readonly cmdManager?: CommandManager | undefined;
}

export const HistoryPanel: FC<HistoryPanelProps> = ({ open, onCancel, cmdManager }) => {
  const undoStack = cmdManager?.getUndoStack() ?? [];
  const redoStack = cmdManager?.getRedoStack() ?? [];

  const handleDoubleClick = (entry: HistoryEntry): void => {
    cmdManager?.undoToIndex(entry.index);
    onCancel();
  };

  return <Modal title="撤销历史" open={open} onCancel={onCancel} footer={null} width={480}>
    <div style={{ maxHeight: 400, overflow: 'auto' }}>
      {undoStack.length > 0 && (
        <>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>可撤销</div>
          <List size="small" dataSource={[...undoStack].reverse() as HistoryEntry[]}
            renderItem={(entry) => (
              <List.Item style={{ cursor: 'pointer', padding: '4px 8px' }}
                onDoubleClick={() => handleDoubleClick(entry)}>
                <span style={{ color: 'var(--ss-text)', fontSize: 13 }}>{entry.description}</span>
              </List.Item>
            )} />
        </>
      )}
      {redoStack.length > 0 && (
        <>
          <div style={{ fontWeight: 600, marginTop: 12, marginBottom: 4, color: 'var(--ss-text-light)' }}>可重做</div>
          <List size="small" dataSource={[...redoStack] as HistoryEntry[]}
            renderItem={(entry) => (
              <List.Item style={{ padding: '4px 8px', opacity: 0.5 }}>
                <span style={{ fontSize: 13 }}>{entry.description}</span>
              </List.Item>
            )} />
        </>
      )}
      {undoStack.length === 0 && redoStack.length === 0 && (
        <div style={{ color: 'var(--ss-text-light)', textAlign: 'center', padding: 24 }}>无操作历史</div>
      )}
    </div>
  </Modal>;
};
