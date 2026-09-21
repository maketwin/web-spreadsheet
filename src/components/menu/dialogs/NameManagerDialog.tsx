import type { FC } from 'react';
import { useState } from 'react';
import { Button, Form, Input, Modal, Space, Table, message } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import type { Store } from '../../../store/Store';
import { NamedRangeService } from '../../../namedrange/NamedRangeService';
import { parseNameBoxInput } from '../../../selection/nameBox';

export interface NameManagerDialogProps {
  readonly open: boolean;
  readonly store: Store;
  readonly onCancel: () => void;
}

interface NameRow {
  readonly name: string;
  readonly refersTo: string;
}

/** Excel 名称规则：不能以单元格引用样式命名（如 A1、R1C1），不含空格。 */
function isValidName(name: string): boolean {
  if (name.length === 0) return false;
  if (/\s/.test(name)) return false;
  if (/^[A-Za-z]+[0-9]+$/.test(name)) return false; // looks like a cell ref
  return /^[A-Za-z_一-龥][\w.一-龥]*$/.test(name);
}

/** Excel 公式 → 名称管理器：list / 新建 / 编辑引用 / 删除（与 Excel 一致，不进撤销栈）。 */
export const NameManagerDialog: FC<NameManagerDialogProps> = ({ open, store, onCancel }) => {
  const svc = new NamedRangeService();
  const [tick, setTick] = useState(0);
  void tick;
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [form] = Form.useForm<{ name: string; refersTo: string }>();

  const rows: NameRow[] = svc.list(store).map(([name]) => ({
    name,
    refersTo: svc.resolveToA1(store, name) ?? '（无效引用）',
  }));

  const refresh = (): void => setTick((t) => t + 1);

  const openEditor = (name: string | null): void => {
    setEditing(name);
    if (name !== null) form.setFieldsValue({ name, refersTo: svc.resolveToA1(store, name) ?? '' });
    else form.resetFields();
    setEditOpen(true);
  };

  const submit = (): void => {
    form.validateFields().then((values) => {
      const name = values.name.trim();
      if (!isValidName(name)) { message.error('名称无效：不能以单元格引用（如 A1）命名，不能含空格'); return; }
      const target = parseNameBoxInput(store, values.refersTo.trim());
      if (target === null) { message.error('引用无效，示例：A1、B2:D5、Sheet2!A1:B2'); return; }
      const { r1, c1, r2, c2 } = target.range;
      const sheetId = target.sheetId ?? store.getActiveSheetId();
      if (editing !== null && editing !== name) svc.remove(store, editing);
      svc.add(store, name, `${r1},${c1}:${r2},${c2}`, sheetId);
      setEditOpen(false);
      refresh();
      message.success(editing !== null ? '已更新名称' : '已新建名称');
    }).catch(() => { /* validation error stays */ });
  };

  const remove = (name: string): void => {
    svc.remove(store, name);
    refresh();
    message.success(`已删除名称 ${name}`);
  };

  return <Modal title="名称管理器" open={open} onCancel={onCancel} footer={<Button type="primary" onClick={onCancel}>关闭</Button>} width={560} destroyOnHidden>
    <Space style={{ marginBottom: 8 }}>
      <Button type="primary" icon={<PlusOutlined />} onClick={() => openEditor(null)}>新建…</Button>
    </Space>
    <Table<NameRow>
      dataSource={rows}
      rowKey="name"
      size="small"
      pagination={false}
      locale={{ emptyText: '尚未定义名称' }}
      columns={[
        { title: '名称', dataIndex: 'name', width: 140 },
        { title: '引用位置', dataIndex: 'refersTo', ellipsis: true },
        {
          title: '操作', key: 'ops', width: 100,
          render: (_: unknown, row) => <Space size={4}>
            <Button size="small" type="text" icon={<EditOutlined />} onClick={() => openEditor(row.name)} />
            <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => remove(row.name)} />
          </Space>,
        },
      ]}
    />
    <Modal
      title={editing !== null ? `编辑名称 — ${editing}` : '新建名称'}
      open={editOpen}
      onCancel={() => setEditOpen(false)}
      onOk={submit}
      okText="确定"
      cancelText="取消"
      destroyOnHidden
      width={420}
    >
      <Form form={form} layout="vertical">
        <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
          <Input placeholder="如 销售数据" />
        </Form.Item>
        <Form.Item name="refersTo" label="引用位置" rules={[{ required: true, message: '请输入引用' }]} extra="示例：A1、B2:D5、Sheet2!A1:B2">
          <Input placeholder="=Sheet1!$A$1:$D$5 或 A1:D5" />
        </Form.Item>
      </Form>
    </Modal>
  </Modal>;
};
