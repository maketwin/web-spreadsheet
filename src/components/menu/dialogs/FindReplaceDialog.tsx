import { Button, Checkbox, Form, Input, Modal, Space, message } from 'antd';
import type { FC } from 'react';
import type { FindReplaceService, FindMatch, FindResult } from '../../../find/FindReplaceService';
import type { Store } from '../../../store/Store';
import type { RangeAddress } from '../../../selection/Range';
import type { CellAddress } from '../../../renderer/coordinate';

export interface FindReplaceDialogProps {
  readonly open: boolean;
  readonly replaceMode?: boolean;
  readonly onCancel: () => void;
  readonly store: Store;
  readonly selected: RangeAddress | null;
  readonly service: FindReplaceService;
  readonly onNavigate: (cell: CellAddress) => void;
  readonly onHighlight: (cells: readonly CellAddress[]) => void;
}

interface FormValues { readonly find: string; readonly replace: string; readonly caseSensitive: boolean }

interface DialogState {
  result: FindResult | null;
  searching: boolean;
}

import { useState, useCallback } from 'react';

export const FindReplaceDialog: FC<FindReplaceDialogProps> = ({ open, replaceMode = false, onCancel, store, selected, service, onNavigate, onHighlight }) => {
  const [form] = Form.useForm<FormValues>();
  const [state, setState] = useState<DialogState>({ result: null, searching: false });

  const doFind = useCallback((): void => {
    const findText = form.getFieldValue('find') as string;
    if (findText === undefined || findText.length === 0) return;
    const caseSensitive = form.getFieldValue('caseSensitive') as boolean;
    const activeCell = selected !== null ? { r: selected.r1, c: selected.c1 } : null;
    const result = service.find(store, { findText, caseSensitive }, activeCell);
    setState({ result, searching: true });
    if (result.currentCell !== null) onNavigate(result.currentCell);
    const cells = result.matches.map((m: FindMatch) => ({ r: m.r, c: m.c }));
    onHighlight(cells);
    if (result.matches.length === 0) message.info('未找到匹配项');
  }, [form, service, store, selected, onNavigate, onHighlight]);

  const doFindNext = useCallback((): void => {
    const result = service.findNext();
    setState({ result, searching: true });
    if (result.currentCell !== null) onNavigate(result.currentCell);
  }, [service, onNavigate]);

  const doReplace = useCallback((): void => {
    const findText = form.getFieldValue('find') as string;
    const replaceText = form.getFieldValue('replace') as string;
    const caseSensitive = form.getFieldValue('caseSensitive') as boolean;
    const result = service.replaceCurrent(store, { findText, replaceText, caseSensitive });
    setState({ result, searching: true });
    if (result.currentCell !== null) onNavigate(result.currentCell);
    message.success('已替换');
  }, [form, service, store, onNavigate]);

  const doReplaceAll = useCallback((): void => {
    const findText = form.getFieldValue('find') as string;
    const replaceText = form.getFieldValue('replace') as string;
    const caseSensitive = form.getFieldValue('caseSensitive') as boolean;
    const count = service.replaceAll(store, { findText, replaceText, caseSensitive });
    setState({ result: null, searching: false });
    onHighlight([]);
    message.success(`已替换 ${count} 处`);
  }, [form, service, store, onHighlight]);

  const label = state.result !== null && state.result.matches.length > 0
    ? `${(state.result.current + 1)} / ${state.result.matches.length}`
    : '';

  return <Modal title={replaceMode ? '查找和替换' : '查找'} open={open} onCancel={onCancel} footer={null} width={460}>
    <Form form={form} layout="vertical" initialValues={{ find: '', replace: '', caseSensitive: false }}>
      <Form.Item name="find" label="查找内容" rules={[{ required: true, message: '请输入查找内容' }]}>
        <Input autoFocus onPressEnter={doFind} />
      </Form.Item>
      {replaceMode && <Form.Item name="replace" label="替换为"><Input /></Form.Item>}
      <Form.Item name="caseSensitive" valuePropName="checked"><Checkbox>区分大小写</Checkbox></Form.Item>
    </Form>
    <Space wrap style={{ marginBottom: 8 }}>
      <Button size="small" onClick={doFind}>查找</Button>
      <Button size="small" onClick={doFindNext} disabled={!state.searching}>查找下一个</Button>
      {replaceMode && <>
        <Button size="small" onClick={doReplace} disabled={!state.searching}>替换</Button>
        <Button size="small" onClick={doReplaceAll}>全部替换</Button>
      </>}
      {label.length > 0 && <span style={{ fontSize: 12, color: '#888' }}>{label}</span>}
    </Space>
  </Modal>;
};
