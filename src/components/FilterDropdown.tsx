import { Button, Checkbox, Input, Radio, Select } from 'antd';
import { useEffect, useMemo, useState, type FC } from 'react';
import { createPortal } from 'react-dom';
import { FilterService, type FilterItem } from '../filter/FilterService';
import { SetAutoFilterCriteriaCommand } from '../commands/impl/SetAutoFilterCriteria';
import { SortRangeCommand } from '../commands/impl/SortRange';
import type { Command } from '../commands/Command';
import type { Store } from '../store/Store';
import type { FilterCondition, FilterConditionOperator } from '../types';

const BLANK = '(空白)';

/** Stable draft key for a checklist item; blanks share one entry. */
const keyOf = (item: FilterItem): string => (item.blank ? BLANK : item.text);

const OPERATOR_OPTIONS: ReadonlyArray<{ value: FilterConditionOperator; label: string }> = [
  { value: 'eq', label: '等于' },
  { value: 'neq', label: '不等于' },
  { value: 'gt', label: '大于' },
  { value: 'gte', label: '大于或等于' },
  { value: 'lt', label: '小于' },
  { value: 'lte', label: '小于或等于' },
  { value: 'between', label: '介于' },
  { value: 'contains', label: '包含' },
  { value: 'notContains', label: '不包含' },
  { value: 'beginsWith', label: '开头是' },
  { value: 'endsWith', label: '结尾是' },
];

const operatorLabel = (operator: FilterConditionOperator): string =>
  OPERATOR_OPTIONS.find((option) => option.value === operator)?.label ?? operator;

interface FilterDropdownProps {
  readonly store: Store;
  readonly cmdManager?: Command;
  readonly cmdManagerExecutor?: (command: Command) => void;
  readonly r: number;
  readonly c: number;
  readonly x: number;
  readonly y: number;
  readonly onClose: () => void;
}

/**
 * Excel-like filter dropdown: sort actions, a custom-condition editor
 * (等于/大于/介于/包含…, two conditions with 与/或), and a value checklist.
 * Checklist edits are a draft until 确定; custom conditions apply on their
 * own 确定, replacing the checklist selection like Excel does.
 */
export const FilterDropdown: FC<FilterDropdownProps> = ({ store, cmdManagerExecutor, r, c, x, y, onClose }) => {
  const service = useMemo(() => new FilterService(store), [store]);
  const filter = store.getAutoFilter();
  const items = useMemo(() => service.getFilterItems(c), [service, c]);
  const criteria = filter?.criteria[c];
  const [search, setSearch] = useState('');
  const [checked, setChecked] = useState<ReadonlySet<string>>(
    () => new Set(items.filter((item) => item.selected).map(keyOf)),
  );
  const [condOpen, setCondOpen] = useState(false);
  const [cond1, setCond1] = useState<FilterCondition>(
    () => criteria?.conditions?.[0] ?? { operator: 'eq', value: '' },
  );
  const [cond2, setCond2] = useState<FilterCondition | undefined>(() => criteria?.conditions?.[1]);
  const [condOp, setCondOp] = useState<'and' | 'or'>(criteria?.conditionsOp ?? 'and');

  useEffect(() => {
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Node;
      const element = document.getElementById('ss-filter-dropdown');
      if (element !== null && element.contains(target)) return;
      // antd popups (operator Select) render in document.body but are part
      // of this dialog; do not treat interactions with them as outside clicks.
      if (target instanceof Element && target.closest('.ant-select-dropdown') !== null) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent): void => { if (event.key === 'Escape') onClose(); };
    const timer = window.setTimeout(() => {
      window.addEventListener('mousedown', onPointerDown, true);
      window.addEventListener('keydown', onKeyDown, true);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('mousedown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [onClose]);

  if (filter === undefined) return null;
  const dataRange = { r1: filter.range.r1 + 1, c1: filter.range.c1, r2: filter.range.r2, c2: filter.range.c2 };
  const run = (command: Command): void => {
    if (cmdManagerExecutor !== undefined) cmdManagerExecutor(command);
    else command.execute(store);
  };

  const query = search.trim().toLowerCase();
  const visible = items.filter((item) => item.text.toLowerCase().includes(query));
  const hasCriteria = criteria !== undefined;
  const hasConditions = criteria?.conditions !== undefined && criteria.conditions.length > 0;
  const allVisibleChecked = visible.length > 0 && visible.every((item) => checked.has(keyOf(item)));
  const someVisibleChecked = visible.some((item) => checked.has(keyOf(item)));

  const toggleItem = (item: FilterItem, nextChecked: boolean): void => {
    const next = new Set(checked);
    if (nextChecked) next.add(keyOf(item)); else next.delete(keyOf(item));
    setChecked(next);
  };

  const toggleVisible = (nextChecked: boolean): void => {
    const next = new Set(checked);
    visible.forEach((item) => { if (nextChecked) next.add(keyOf(item)); else next.delete(keyOf(item)); });
    setChecked(next);
  };

  const confirmChecklist = (): void => {
    const allSelected = items.length > 0 && items.every((item) => checked.has(keyOf(item)));
    if (allSelected) {
      if (hasCriteria) run(new SetAutoFilterCriteriaCommand({ column: c, mode: 'clearColumn' }));
    } else {
      run(new SetAutoFilterCriteriaCommand({
        column: c,
        mode: 'set',
        criteria: {
          selected: items.filter((item) => !item.blank && checked.has(item.text)).map((item) => item.text),
          includeBlanks: items.some((item) => item.blank) ? checked.has(BLANK) : true,
        },
      }));
    }
    onClose();
  };

  const confirmConditions = (): void => {
    const conditions: FilterCondition[] = [];
    if (cond1.value !== '') conditions.push(cond1);
    if (cond2 !== undefined && cond2.value !== '') conditions.push(cond2);
    if (conditions.length === 0) {
      if (hasCriteria) run(new SetAutoFilterCriteriaCommand({ column: c, mode: 'clearColumn' }));
    } else {
      run(new SetAutoFilterCriteriaCommand({
        column: c,
        mode: 'set',
        // Custom conditions replace the checklist, like Excel.
        criteria: { selected: [], includeBlanks: false, conditions, conditionsOp: condOp },
      }));
    }
    onClose();
  };

  const clearColumn = (): void => {
    if (hasCriteria) run(new SetAutoFilterCriteriaCommand({ column: c, mode: 'clearColumn' }));
    onClose();
  };

  const sort = (direction: 'asc' | 'desc'): void => {
    run(new SortRangeCommand({ ...dataRange, sortCol: c, direction }));
    onClose();
  };

  const left = Math.max(4, Math.min(x, window.innerWidth - 300));
  const top = Math.max(4, Math.min(y, window.innerHeight - 480));

  const conditionRow = (
    cond: FilterCondition,
    onChange: (next: FilterCondition | undefined) => void,
    removable: boolean,
  ): JSX.Element => (
    <div className="ss-filter-dropdown__cond-row">
      <Select
        size="small"
        value={cond.operator}
        options={OPERATOR_OPTIONS as unknown as { value: string; label: string }[]}
        onChange={(operator) => onChange({ ...cond, operator: operator as FilterConditionOperator })}
        popupMatchSelectWidth={false}
      />
      <Input
        size="small"
        value={cond.value}
        placeholder="值"
        onChange={(event) => onChange({ ...cond, value: event.target.value })}
      />
      {cond.operator === 'between' && (
        <Input
          size="small"
          value={cond.value2 ?? ''}
          placeholder="最大值"
          onChange={(event) => onChange({ ...cond, value2: event.target.value })}
        />
      )}
      {removable && <Button size="small" type="text" onClick={() => onChange(undefined)}>✕</Button>}
    </div>
  );

  return createPortal(
    <div id="ss-filter-dropdown" className="ss-filter-dropdown" style={{ left, top }} role="dialog" aria-label="筛选" data-row={r}>
      <div className="ss-filter-dropdown__sort">
        <Button size="small" onClick={() => sort('asc')}>升序</Button>
        <Button size="small" onClick={() => sort('desc')}>降序</Button>
        <Button size="small" disabled={!hasCriteria} onClick={clearColumn}>清除筛选</Button>
      </div>
      <Button
        size="small"
        type={hasConditions ? 'primary' : 'default'}
        ghost={hasConditions}
        onClick={() => setCondOpen(!condOpen)}
      >
        {hasConditions && !condOpen
          ? `条件：${criteria.conditions?.map((cond) => `${operatorLabel(cond.operator)} ${cond.value}${cond.operator === 'between' ? ` ~ ${cond.value2 ?? ''}` : ''}`).join(criteria.conditionsOp === 'or' ? ' 或 ' : ' 与 ')}`
          : '条件筛选'}
      </Button>
      {condOpen && (
        <div className="ss-filter-dropdown__cond">
          {conditionRow(cond1, (next) => { if (next !== undefined) setCond1(next); }, false)}
          <div className="ss-filter-dropdown__cond-row">
            <Radio.Group
              size="small"
              value={condOp}
              onChange={(event) => setCondOp(event.target.value as 'and' | 'or')}
              options={[{ value: 'and', label: '与' }, { value: 'or', label: '或' }]}
              optionType="button"
            />
            {cond2 === undefined && (
              <Button size="small" type="link" onClick={() => setCond2({ operator: 'eq', value: '' })}>添加条件</Button>
            )}
          </div>
          {cond2 !== undefined && conditionRow(cond2, setCond2, true)}
          <div className="ss-filter-dropdown__cond-actions">
            <Button size="small" type="primary" onClick={confirmConditions}>确定</Button>
            <Button size="small" onClick={() => setCondOpen(false)}>收起</Button>
          </div>
        </div>
      )}
      <Input
        size="small"
        placeholder="搜索"
        value={search}
        allowClear
        onChange={(event) => setSearch(event.target.value)}
      />
      <div className="ss-filter-dropdown__list">
        <Checkbox
          checked={allVisibleChecked}
          indeterminate={someVisibleChecked && !allVisibleChecked}
          onChange={(event) => toggleVisible(event.target.checked)}
        >
          全选
        </Checkbox>
        {visible.map((item) => (
          <Checkbox
            key={keyOf(item)}
            checked={checked.has(keyOf(item))}
            onChange={(event) => toggleItem(item, event.target.checked)}
          >
            <span className="ss-filter-dropdown__value">
              <span className="ss-filter-dropdown__text">{item.text}</span>
              <span className="ss-filter-dropdown__count">{item.count}</span>
            </span>
          </Checkbox>
        ))}
        {visible.length === 0 && <div className="ss-filter-dropdown__empty">没有匹配项</div>}
      </div>
      <div className="ss-filter-dropdown__footer">
        <Button size="small" type="primary" onClick={confirmChecklist}>确定</Button>
        <Button size="small" onClick={onClose}>取消</Button>
      </div>
    </div>,
    document.body,
  );
};
