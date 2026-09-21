import type { FC } from 'react';
import { useState } from 'react';
import { Button, Checkbox, Modal, Space, Table, message } from 'antd';
import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined } from '@ant-design/icons';
import type { Store } from '../../../store/Store';
import type { CommandManager } from '../../../commands/CommandManager';
import type { ConditionalRule } from '../../../conditional/ConditionalRule';
import { SetSheetConditionalRulesCommand } from '../../../commands/impl/SetConditionalFormat';
import { xy2expr } from '../../../util/alphabet';

export interface ConditionalRulesDialogProps {
  readonly open: boolean;
  readonly store: Store;
  readonly cmdManager?: CommandManager | undefined;
  readonly onCancel: () => void;
}

interface RuleRow {
  readonly key: string;
  readonly rangeKey: string;
  readonly rangeLabel: string;
  readonly typeLabel: string;
  readonly summary: string;
  readonly disabled: boolean;
}

function rangeKeyToA1(key: string): string {
  const [lo, hi] = key.split(':');
  const nums = [...(lo ?? '').split(','), ...(hi ?? '').split(',')].map(Number);
  if (nums.length !== 4 || nums.some((n) => !Number.isInteger(n))) return key;
  return `${xy2expr(nums[1] ?? 0, nums[0] ?? 0)}:${xy2expr(nums[3] ?? 0, nums[2] ?? 0)}`;
}

function ruleText(rule: ConditionalRule): { typeLabel: string; summary: string } {
  switch (rule.type) {
    case 'dataBar': return { typeLabel: '数据条', summary: `${rule.min} ~ ${rule.max}` };
    case 'colorScale': return { typeLabel: '色阶', summary: `${rule.minColor} → ${rule.maxColor}` };
    case 'cellValue': {
      const ops: Record<string, string> = { gt: '>', gte: '≥', lt: '<', lte: '≤', eq: '=', neq: '≠', between: '介于', contains: '包含' };
      const op = ops[rule.operator] ?? rule.operator;
      const second = rule.value2 !== undefined ? ` ~ ${String(rule.value2)}` : '';
      return { typeLabel: '单元格值', summary: `${op} ${String(rule.value)}${second}` };
    }
    case 'formula': return { typeLabel: '公式条件', summary: rule.formula };
    case 'iconSet': {
      const name = rule.icons === 'arrows3' ? '3 色箭头' : '3 灯';
      const [hi, lo] = rule.thresholds ?? [67, 33];
      return { typeLabel: '图标集', summary: `${name}（${rule.basis === 'num' ? '数值' : '百分比'} ${hi}/${lo}）` };
    }
  }
}

/** Excel 开始 → 条件格式 → 管理规则…: list / toggle / reorder / delete, one undo step. */
export const ConditionalRulesDialog: FC<ConditionalRulesDialogProps> = ({ open, store, cmdManager, onCancel }) => {
  const [tick, setTick] = useState(0);
  void tick;

  const entries = store.getConditionalRules();
  const rows: RuleRow[] = [];
  entries.forEach(([rangeKey, rules]) => {
    rules.forEach((rule, i) => {
      const { typeLabel, summary } = ruleText(rule);
      rows.push({
        key: `${rangeKey}#${i}`,
        rangeKey,
        rangeLabel: rangeKeyToA1(rangeKey),
        typeLabel,
        summary,
        disabled: rule.disabled === true,
      });
    });
  });

  const commit = (mutate: (draft: Array<[string, ConditionalRule[]]>) => void): void => {
    const draft: Array<[string, ConditionalRule[]]> = entries.map(([k, rules]) => [k, [...rules]]);
    mutate(draft);
    const next = draft.filter(([, rules]) => rules.length > 0);
    if (cmdManager !== undefined) cmdManager.execute(new SetSheetConditionalRulesCommand({ entries: next }));
    else {
      for (const [key] of store.getConditionalRules()) store.removeConditionalRule(key);
      for (const [key, rules] of next) store.setConditionalRule(key, rules);
    }
    setTick((t) => t + 1);
  };

  const findRule = (row: RuleRow): { listIndex: number; ruleIndex: number } | null => {
    const listIndex = entries.findIndex(([k]) => k === row.rangeKey);
    if (listIndex < 0) return null;
    const ruleIndex = Number(row.key.split('#')[1]);
    return { listIndex, ruleIndex };
  };

  const toggle = (row: RuleRow): void => {
    const pos = findRule(row);
    if (pos === null) return;
    commit((draft) => {
      const rules = draft[pos.listIndex]?.[1];
      const rule = rules?.[pos.ruleIndex];
      if (rule === undefined) return;
      rules![pos.ruleIndex] = rule.disabled === true ? { ...rule, disabled: false } : { ...rule, disabled: true };
    });
  };

  const remove = (row: RuleRow): void => {
    const pos = findRule(row);
    if (pos === null) return;
    commit((draft) => { draft[pos.listIndex]?.[1].splice(pos.ruleIndex, 1); });
    message.success('已删除规则');
  };

  const move = (row: RuleRow, delta: -1 | 1): void => {
    const pos = findRule(row);
    if (pos === null) return;
    commit((draft) => {
      const rules = draft[pos.listIndex]?.[1];
      if (rules === undefined) return;
      const target = pos.ruleIndex + delta;
      if (target < 0 || target >= rules.length) return;
      const tmp = rules[pos.ruleIndex]!;
      rules[pos.ruleIndex] = rules[target]!;
      rules[target] = tmp;
    });
  };

  return <Modal title="条件格式规则管理器" open={open} onCancel={onCancel} footer={<Button type="primary" onClick={onCancel}>关闭</Button>} width={640} destroyOnHidden>
    <Table<RuleRow>
      dataSource={rows}
      rowKey="key"
      size="small"
      pagination={false}
      locale={{ emptyText: '当前工作表没有条件格式规则' }}
      columns={[
        { title: '应用于', dataIndex: 'rangeLabel', width: 110 },
        { title: '类型', dataIndex: 'typeLabel', width: 90 },
        { title: '规则', dataIndex: 'summary', ellipsis: true },
        {
          title: '启用', dataIndex: 'disabled', width: 60,
          render: (disabled: boolean, row) => <Checkbox checked={!disabled} onChange={() => toggle(row)} />,
        },
        {
          title: '操作', key: 'ops', width: 120,
          render: (_: unknown, row) => <Space size={4}>
            <Button size="small" type="text" icon={<ArrowUpOutlined />} onClick={() => move(row, -1)} />
            <Button size="small" type="text" icon={<ArrowDownOutlined />} onClick={() => move(row, 1)} />
            <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => remove(row)} />
          </Space>,
        },
      ]}
    />
  </Modal>;
};
