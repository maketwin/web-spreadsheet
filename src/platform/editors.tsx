import { Form, Input, InputNumber, Modal, Radio, Select, Switch } from 'antd';
import { useEffect, type ReactElement } from 'react';
import type { ApiInterface, ApiRule, FaultKind, HttpMethod, ResponseKind, RuleMatchers, Scenario } from './types';

/** 表单草稿与领域对象互转：id 为空 = 新建。 */

export interface InterfaceDraft {
  readonly id: string | undefined;
  readonly name: string;
  readonly method: HttpMethod;
  readonly urlPattern: string;
  readonly upstream: string;
  readonly fallback: 'error' | 'empty';
  readonly assertions: ReadonlyArray<{ key: string; equals: string }>;
}

export interface RuleDraft {
  readonly id: string | undefined;
  readonly name: string;
  readonly priority: number;
  readonly enabled: boolean;
  readonly fault: FaultKind;
  readonly faultProbability: number;
  readonly delayMs: number;
  readonly kind: ResponseKind;
  readonly matchers: ReadonlyArray<{ key: string; value: string }>;
  readonly bodyText: string;
}

export interface ScenarioDraft {
  readonly id: string | undefined;
  readonly name: string;
  readonly description: string;
  readonly rules: Readonly<Record<string, string>>;
}

const newId = (prefix: string): string => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;

export function interfaceToDraft(iface: ApiInterface | undefined): InterfaceDraft {
  return {
    id: iface?.id,
    name: iface?.name ?? '',
    method: iface?.method ?? 'GET',
    urlPattern: iface?.urlPattern ?? '/api/',
    upstream: iface?.upstream ?? '',
    fallback: iface?.fallback ?? 'error',
    assertions: (iface?.assertions ?? []).map((a) => ({ key: a.key, equals: a.equals ?? '' })),
  };
}

export function draftToInterface(draft: InterfaceDraft): ApiInterface {
  const assertions = draft.assertions
    .filter((a) => a.key.trim() !== '')
    .map((a) => (a.equals.trim() === '' ? { key: a.key.trim() } : { key: a.key.trim(), equals: a.equals }));
  return {
    id: draft.id ?? newId('iface'),
    name: draft.name.trim(),
    method: draft.method,
    urlPattern: draft.urlPattern.trim(),
    ...(draft.upstream.trim() !== '' ? { upstream: draft.upstream.trim() } : {}),
    fallback: draft.fallback,
    ...(assertions.length > 0 ? { assertions } : {}),
  };
}

export function ruleToDraft(rule: ApiRule | undefined): RuleDraft {
  return {
    id: rule?.id,
    name: rule?.name ?? '',
    priority: rule?.priority ?? 10,
    enabled: rule?.enabled ?? true,
    fault: rule?.fault ?? 'none',
    faultProbability: rule?.faultProbability ?? 1,
    delayMs: rule?.delayMs ?? 0,
    kind: rule?.response.kind ?? 'static',
    matchers: Object.entries(rule?.matchers.query ?? {}).map(([key, value]) => ({ key, value })),
    bodyText: rule !== undefined && rule.response.kind !== 'capture'
      ? (rule.response.kind === 'script' ? String(rule.response.body) : JSON.stringify(rule.response.body, null, 2))
      : '{\n  \n}',
  };
}

/** 草稿转规则；static/template 的 JSON 不合法时抛可读错误（调用方在表单层展示）。 */
export function draftToRule(draft: RuleDraft, interfaceId: string): ApiRule {
  let body: unknown = null;
  if (draft.kind === 'static' || draft.kind === 'template') {
    body = JSON.parse(draft.bodyText); // throws SyntaxError -> 调用方捕获
  } else if (draft.kind === 'script') {
    body = draft.bodyText;
  }
  const query: Record<string, string> = {};
  for (const m of draft.matchers) {
    if (m.key.trim() !== '') query[m.key.trim()] = m.value;
  }
  const matchers: RuleMatchers = Object.keys(query).length > 0 ? { query } : {};
  return {
    id: draft.id ?? newId('rule'),
    interfaceId,
    name: draft.name.trim(),
    matchers,
    response: { kind: draft.kind, body },
    fault: draft.fault,
    ...(draft.fault !== 'none' && draft.faultProbability < 1 ? { faultProbability: draft.faultProbability } : {}),
    ...(draft.delayMs > 0 ? { delayMs: draft.delayMs } : {}),
    enabled: draft.enabled,
    priority: draft.priority,
  };
}

interface ModalProps<T> {
  readonly open: boolean;
  readonly onCancel: () => void;
  readonly onSave: (draft: T) => void;
}

/** 接口编辑：名称/方法/URL 模式/真实上游/兜底/入参断言。 */
export function InterfaceEditorModal({ open, initial, onCancel, onSave }: ModalProps<InterfaceDraft> & { initial: InterfaceDraft }): ReactElement {
  const [form] = Form.useForm<InterfaceDraft>();
  useEffect(() => {
    if (open) form.setFieldsValue(initial);
  }, [open, initial, form]);
  return (
    <Modal title={initial.id === undefined ? '新增接口' : '编辑接口'} open={open} onOk={() => void form.validateFields().then(onSave).catch(() => undefined)} onCancel={onCancel} okText="保存" cancelText="取消" destroyOnHidden>
      <Form form={form} layout="vertical">
        <Form.Item name="name" label="名称" rules={[{ required: true, message: '必填' }]}>
          <Input placeholder="销售明细" />
        </Form.Item>
        <Form.Item name="method" label="方法" initialValue="GET">
          <Radio.Group options={[{ label: 'GET', value: 'GET' }, { label: 'POST', value: 'POST' }]} optionType="button" />
        </Form.Item>
        <Form.Item name="urlPattern" label="URL 模式（支持 {param}）" rules={[{ required: true, message: '必填' }]}>
          <Input placeholder="/api/sales 或 /api/orders/{id}" />
        </Form.Item>
        <Form.Item name="upstream" label="真实上游 URL（可选，配置后可同步真实数据）">
          <Input placeholder="https://your-api.example.com/sales（留空 = 纯 mock）" />
        </Form.Item>
        <Form.Item name="fallback" label="未命中兜底" initialValue="error">
          <Select options={[{ label: '返回 #API! 错误', value: 'error' }, { label: '返回空', value: 'empty' }]} />
        </Form.Item>
        <Form.Item label="入参断言（只校验表格发出的 query，不影响出参；值留空 = 只查参数存在）">
          <Form.List name="assertions">
            {(fields, { add, remove }) => (
              <>
                {fields.map((field) => (
                  <div key={field.key} style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
                    <Form.Item name={[field.name, 'key']} noStyle><Input placeholder="参数名，如 region" style={{ width: 130 }} /></Form.Item>
                    <Form.Item name={[field.name, 'equals']} noStyle><Input placeholder="期望值（留空=存在即可）" /></Form.Item>
                    <a onClick={() => remove(field.name)} style={{ fontSize: 12 }}>删除</a>
                  </div>
                ))}
                <a onClick={() => add({ key: '', equals: '' })} style={{ fontSize: 12 }}>+ 添加断言</a>
              </>
            )}
          </Form.List>
        </Form.Item>
      </Form>
    </Modal>
  );
}

/** 规则编辑：匹配器/出参（static JSON、template、script、capture）/故障/概率/延迟/优先级。 */
export function RuleEditorModal({ open, initial, interfaceName, onCancel, onSave }: ModalProps<RuleDraft> & { initial: RuleDraft; interfaceName: string }): ReactElement {
  const [form] = Form.useForm<RuleDraft>();
  useEffect(() => {
    if (open) form.setFieldsValue(initial);
  }, [open, initial, form]);
  const kind: ResponseKind = Form.useWatch('kind', form) ?? initial.kind;
  const fault: FaultKind = Form.useWatch('fault', form) ?? initial.fault;
  return (
    <Modal title={`规则 — ${interfaceName}`} open={open} width={520} onOk={() => void form.validateFields().then(onSave).catch(() => undefined)} onCancel={onCancel} okText="保存" cancelText="取消" destroyOnHidden>
      <Form form={form} layout="vertical">
        <Form.Item name="name" label="规则名" rules={[{ required: true, message: '必填' }]}>
          <Input placeholder="正常数据" />
        </Form.Item>
        <Form.Item label="出参来源" required>
          <Form.Item name="kind" noStyle initialValue="static">
            <Radio.Group
              options={[
                { label: '静态 JSON', value: 'static' },
                { label: '模板', value: 'template' },
                { label: '脚本', value: 'script' },
                { label: '真实捕获', value: 'capture' },
              ]}
              optionType="button"
            />
          </Form.Item>
        </Form.Item>
        {kind === 'capture'
          ? <p style={{ color: '#888', fontSize: 12, marginTop: -12 }}>返回该接口最近一次"同步真实数据"抓到的响应体；出参无需填写。</p>
          : (
            <Form.Item
              name="bodyText"
              label={kind === 'script' ? '脚本（签名 (req) => body，req = { query, path }）' : kind === 'template' ? '出参模板（支持 {{query.x}} / {{path.x}}）' : '出参 JSON'}
              rules={[
                {
                  validator: (_, value: string | undefined) => {
                    if (value === undefined || value.trim() === '') return Promise.reject(new Error('必填'));
                    if (kind === 'static' || kind === 'template') {
                      try {
                        JSON.parse(value);
                      } catch {
                        return Promise.reject(new Error('不是合法的 JSON'));
                      }
                    }
                    return Promise.resolve();
                  },
                },
              ]}
            >
              {kind === 'script'
                ? (
                  <Input.TextArea
                    rows={6}
                    style={{ fontFamily: 'Consolas, Menlo, monospace' }}
                    placeholder={'return {\n  amount: Number(req.path.id) * 3,\n  status: "脚本生成"\n};'}
                  />
                )
                : <Input.TextArea rows={6} style={{ fontFamily: 'Consolas, Menlo, monospace' }} />}
            </Form.Item>
          )}
        <Form.Item label="入参匹配（query，全部命中才生效；值为 * 通配）">
          <Form.List name="matchers">
            {(fields, { add, remove }) => (
              <>
                {fields.map((field) => (
                  <div key={field.key} style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
                    <Form.Item name={[field.name, 'key']} noStyle><Input placeholder="参数名" style={{ width: 140 }} /></Form.Item>
                    <Form.Item name={[field.name, 'value']} noStyle><Input placeholder="值 或 *" /></Form.Item>
                    <a onClick={() => remove(field.name)} style={{ fontSize: 12 }}>删除</a>
                  </div>
                ))}
                <a onClick={() => add({ key: '', value: '' })} style={{ fontSize: 12 }}>+ 添加匹配条件</a>
              </>
            )}
          </Form.List>
        </Form.Item>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
          <Form.Item name="priority" label="优先级（小优先）" initialValue={10}>
            <InputNumber min={0} max={999} />
          </Form.Item>
          <Form.Item name="enabled" label="启用" valuePropName="checked" initialValue={true}>
            <Switch size="small" />
          </Form.Item>
          <Form.Item name="delayMs" label="延迟 ms（逻辑）" initialValue={0}>
            <InputNumber min={0} max={60000} step={100} />
          </Form.Item>
        </div>
        <Form.Item name="fault" label="故障注入" initialValue="none">
          <Radio.Group
            options={[
              { label: '无', value: 'none' },
              { label: '500', value: 'error' },
              { label: '超时', value: 'timeout' },
            ]}
            optionType="button"
            size="small"
          />
        </Form.Item>
        {fault !== 'none' && (
          <Form.Item name="faultProbability" label="触发概率（0~1，稳定种子，回放可复现）" initialValue={1}>
            <InputNumber min={0} max={1} step={0.1} style={{ width: 120 }} />
          </Form.Item>
        )}
        {fault !== 'none' && <p style={{ color: '#cf1322', fontSize: 12, marginTop: -8 }}>触发时命中本规则即返回 #API!（出参不生效）。</p>}
      </Form>
    </Modal>
  );
}

/** 场景编辑：命名 + 每个接口选一条规则。 */
export function ScenarioEditorModal({ open, initial, interfaces, rules, onCancel, onSave }: ModalProps<ScenarioDraft> & { initial: ScenarioDraft; interfaces: readonly ApiInterface[]; rules: readonly ApiRule[] }): ReactElement {
  const [form] = Form.useForm<ScenarioDraft>();
  useEffect(() => {
    if (open) form.setFieldsValue(initial);
  }, [open, initial, form]);
  return (
    <Modal title={initial.id === undefined ? '新增场景' : '编辑场景'} open={open} onOk={() => void form.validateFields().then(onSave).catch(() => undefined)} onCancel={onCancel} okText="保存" cancelText="取消" destroyOnHidden>
      <Form form={form} layout="vertical">
        <Form.Item name="name" label="场景名" rules={[{ required: true, message: '必填' }]}>
          <Input placeholder="正常经营" />
        </Form.Item>
        <Form.Item name="description" label="描述">
          <Input placeholder="全部接口正常返回" />
        </Form.Item>
        {interfaces.map((iface) => (
          <Form.Item key={iface.id} name={['rules', iface.id]} label={`${iface.name}（${iface.method} ${iface.urlPattern}）`} initialValue={initial.rules[iface.id]}>
            <Select
              allowClear
              placeholder="按优先级匹配"
              options={rules.filter((r) => r.interfaceId === iface.id).map((r) => ({ label: r.name, value: r.id }))}
            />
          </Form.Item>
        ))}
      </Form>
    </Modal>
  );
}

export function scenarioToDraft(scenario: Scenario | undefined): ScenarioDraft {
  return {
    id: scenario?.id,
    name: scenario?.name ?? '',
    description: scenario?.description ?? '',
    rules: scenario?.rules ?? {},
  };
}

export function draftToScenario(draft: ScenarioDraft): Scenario {
  return {
    id: draft.id ?? newId('scenario'),
    name: draft.name.trim(),
    description: draft.description,
    rules: { ...draft.rules },
  };
}
