import { Modal, Input, Button, message } from 'antd';
import { useEffect, useState, type FC } from 'react';
import { hashPassword } from '../../../util/passwordHash';
import type { Store } from '../../../store/Store';

export interface WorkbookPasswordDialogsProps {
  readonly dialog: string | null; // 'workbookPassword' | 'workbookPasswordClear' | null
  readonly store: Store;
  readonly onSetHash: (hash: string | undefined) => void;
  readonly onClose: () => void;
}

/** 设置 / 更改 / 取消工作簿密码（FNV-1a 哈希；客户端门槛而非加密）。 */
export const WorkbookPasswordDialogs: FC<WorkbookPasswordDialogsProps> = ({ dialog, store, onSetHash, onClose }) => {
  const isClear = dialog === 'workbookPasswordClear';
  const isSet = dialog === 'workbookPassword';
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isSet || isClear) { setPw(''); setConfirm(''); setBusy(false); }
  }, [isSet, isClear]);

  const finish = (): void => {
    if (pw === '') { message.warning('请输入密码'); return; }
    if (isClear) {
      if (hashPassword(pw) !== store.getWorkbookPasswordHash()) { message.error('密码错误'); return; }
      store.setWorkbookPasswordHash(undefined);
      onSetHash(undefined);
      message.success('已取消工作簿密码');
      onClose();
      return;
    }
    if (pw !== confirm) { message.error('两次输入的密码不一致'); return; }
    store.setWorkbookPasswordHash(hashPassword(pw));
    onSetHash(hashPassword(pw));
    message.success('工作簿密码已设置');
    onClose();
  };

  if (!isSet && !isClear) return null;
  return <Modal
    title={isClear ? '取消工作簿密码' : '设置工作簿密码'}
    open
    onCancel={() => { if (!busy) onClose(); }}
    footer={[
      <Button key="cancel" disabled={busy} onClick={onClose}>取消</Button>,
      <Button key="ok" type="primary" loading={busy} onClick={finish}>{isClear ? '取消密码' : '确定'}</Button>,
    ]}
    width={380}
  >
    {isClear ? (
      <Input.Password placeholder="输入当前密码" value={pw} onChange={(e) => setPw(e.target.value)} />
    ) : (
      <>
        <Input.Password placeholder="输入密码" value={pw} onChange={(e) => setPw(e.target.value)} style={{ marginBottom: 12 }} />
        <Input.Password placeholder="确认密码" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </>
    )}
  </Modal>;
};
