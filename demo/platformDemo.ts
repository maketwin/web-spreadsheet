import type { CellInput, Style } from '../src';
import type { MockProject } from '../src/platform';

/**
 * 演示项目：一张"销售看板"工作簿 + 它依赖的三个接口。
 *
 * - 入参分化演示：kpi 接口的规则按 query.region 区分（区域单元格改 south 切规则）。
 * - 真实直通演示：三个接口都配了同源静态上游（demo/upstream/*.json），
 *   "真实上游"场景 + 同步按钮走真实 fetch 捕获，数据与 mock 不同。
 */
export const demoProject: MockProject = {
  name: '销售看板演示',
  interfaces: [
    {
      id: 'sales', name: '销售明细', method: 'GET', urlPattern: '/api/sales', fallback: 'error', upstream: 'demo/upstream/sales.json',
    },
    {
      id: 'kpi', name: '经营指标', method: 'GET', urlPattern: '/api/kpi', fallback: 'error', upstream: 'demo/upstream/kpi.json',
      assertions: [{ key: 'region', oneOf: ['north', 'south'] }],
    },
    { id: 'order', name: '订单详情', method: 'GET', urlPattern: '/api/orders/{id}', fallback: 'error', upstream: 'demo/upstream/order.json' },
  ],
  rules: [
    {
      id: 'sales-full', interfaceId: 'sales', name: '正常数据',
      matchers: {},
      response: {
        kind: 'static',
        body: [
          ['产品', 'Q1', 'Q2', 'Q3', 'Q4'],
          ['产品A', 100, 120, 150, 180],
          ['产品B', 80, 90, 110, 130],
          ['产品C', 200, 210, 230, 250],
        ],
      },
      fault: 'none', enabled: true, priority: 10,
    },
    { id: 'sales-empty', interfaceId: 'sales', name: '空数据', matchers: {}, response: { kind: 'static', body: [] }, fault: 'none', enabled: true, priority: 20 },
    { id: 'sales-500', interfaceId: 'sales', name: '服务端 500', matchers: {}, response: { kind: 'static', body: null }, fault: 'error', enabled: true, priority: 30 },
    {
      id: 'kpi-normal', interfaceId: 'kpi', name: '北区指标',
      matchers: { query: { region: 'north' } },
      response: { kind: 'template', body: { region: '{{query.region}}', revenue: 1280000, orders: 4200, growth: 0.18 } },
      fault: 'none', enabled: true, priority: 10,
    },
    {
      id: 'kpi-south', interfaceId: 'kpi', name: '南区指标',
      matchers: { query: { region: 'south' } },
      response: { kind: 'template', body: { region: '{{query.region}}', revenue: 640000, orders: 1900, growth: -0.05 } },
      fault: 'none', enabled: true, priority: 5,
    },
    { id: 'kpi-500', interfaceId: 'kpi', name: '指标服务故障', matchers: {}, response: { kind: 'static', body: null }, fault: 'error', enabled: true, priority: 30 },
    {
      id: 'order-ok', interfaceId: 'order', name: '订单正常',
      matchers: {},
      response: { kind: 'template', body: { id: '{{path.id}}', status: '已发货', amount: 299 } },
      fault: 'none', enabled: true, priority: 10,
    },
    { id: 'order-500', interfaceId: 'order', name: '订单服务故障', matchers: {}, response: { kind: 'static', body: null }, fault: 'error', enabled: true, priority: 30 },
    { id: 'sales-capture', interfaceId: 'sales', name: '真实销售（捕获）', matchers: {}, response: { kind: 'capture', body: null }, fault: 'none', enabled: true, priority: 50 },
    { id: 'kpi-capture', interfaceId: 'kpi', name: '真实指标（捕获）', matchers: {}, response: { kind: 'capture', body: null }, fault: 'none', enabled: true, priority: 50 },
    { id: 'order-capture', interfaceId: 'order', name: '真实订单（捕获）', matchers: {}, response: { kind: 'capture', body: null }, fault: 'none', enabled: true, priority: 50 },
    {
      // 脚本出参：按入参动态计算（覆盖签名/分页类逻辑）
      id: 'kpi-script', interfaceId: 'kpi', name: '动态指标（脚本）',
      matchers: {},
      response: {
        kind: 'script',
        body: 'return {\n  region: req.query.region,\n  revenue: 2000000 + (req.query.region === "south" ? -500000 : 0),\n  orders: 6000,\n  growth: 0.25\n};',
      },
      fault: 'none', enabled: true, priority: 60,
    },
    {
      // 脚本出参：路径参数参与计算
      id: 'order-script', interfaceId: 'order', name: '动态订单（脚本）',
      matchers: {},
      response: {
        kind: 'script',
        body: 'return {\n  id: req.path.id,\n  status: "脚本生成·运输中",\n  amount: Number(req.path.id) * 3\n};',
      },
      fault: 'none', enabled: true, priority: 60,
    },
    {
      // 概率故障：稳定种子，回放可复现；未触发时返回正常数据
      id: 'sales-flaky', interfaceId: 'sales', name: '不稳定接口（50% 500）',
      matchers: {},
      response: {
        kind: 'static',
        body: [
          ['产品', 'Q1', 'Q2', 'Q3', 'Q4'],
          ['产品D', 60, 75, 90, 110],
          ['产品E', 130, 120, 140, 160],
        ],
      },
      fault: 'error', faultProbability: 0.5, delayMs: 300, enabled: true, priority: 70,
    },
  ],
  scenarios: [
    { id: 'normal', name: '正常经营', description: '全部接口正常返回（mock）', rules: { sales: 'sales-full', kpi: 'kpi-normal', order: 'order-ok' } },
    { id: 'empty', name: '接口空数据', description: '明细返回空数组 —— 看溢出收敛、汇总归零', rules: { sales: 'sales-empty', kpi: 'kpi-normal', order: 'order-ok' } },
    { id: 'down', name: '接口故障', description: '全部接口 500 —— 看 #API! 错误传播', rules: { sales: 'sales-500', kpi: 'kpi-500', order: 'order-500' } },
    { id: 'real', name: '真实上游', description: '点"同步真实数据"抓上游 —— 捕获到货后整表刷新', rules: { sales: 'sales-capture', kpi: 'kpi-capture', order: 'order-capture' } },
    { id: 'advanced', name: '动态与不稳定', description: '脚本出参（kpi/order）+ 明细 50% 概率 500 + 300ms 逻辑延迟', rules: { sales: 'sales-flaky', kpi: 'kpi-script', order: 'order-script' } },
  ],
};

/**
 * 演示工作簿：指标区（API.GET 标量取数）+ 明细区（API.DATA 溢出）+ 汇总公式。
 * B3 区域单元格是入参源：改成 south 后 kpi 规则引擎切换到"南区指标"。
 * 视觉样式由 demo/platform.tsx 挂载后写入样式表（种子 Cell 只带 styleId 引用）。
 */
export const demoWorkbook: readonly (readonly CellInput[])[] = [
  [{ text: '销售看板 — Mock 平台演示' }],
  [],
  [{ text: '区域' }, { text: 'north' }],
  [{ text: '营收' }, { formula: '=API.GET("/api/kpi?region="&B3,"revenue")' }],
  [{ text: '订单量' }, { formula: '=API.GET("/api/kpi?region="&B3,"orders")' }],
  [{ text: '增长率' }, { formula: '=API.GET("/api/kpi?region="&B3,"growth")' }],
  [{ text: '示例订单' }, { formula: '=API.GET("/api/orders/1001","status")' }],
  [],
  [{ text: '销售明细（=API.DATA("/api/sales") 拉取）' }],
  // A9 是溢出锚点：正常场景下展开为 4 行 × 5 列（表头 + 3 个产品）
  [{ formula: '=API.DATA("/api/sales")' }, {}, {}, {}, {}, { text: '行总计' }],
  [{}, {}, {}, {}, {}, { formula: '=SUM(B11:E11)' }],
  [{}, {}, {}, {}, {}, { formula: '=SUM(B12:E12)' }],
  [{}, {}, {}, {}, {}, { formula: '=SUM(B13:E13)' }],
  [],
  [{ text: '合计' }, { formula: '=SUM(B11:B13)' }, { formula: '=SUM(C11:C13)' }, { formula: '=SUM(D11:D13)' }, { formula: '=SUM(E11:E13)' }],
];

/** 演示样式表：[行, 列, 样式]。挂载后直接写 store 样式表，不经过命令总线（不产生操作记录）。 */
export const demoStyles: readonly (readonly [number, number, Style])[] = [
  [0, 0, { bold: true, fontSize: 14, color: '#217346' }],
  [2, 0, { bold: true }],
  [2, 1, { bgcolor: '#ffe7ba' }],
  [3, 0, { bold: true }],
  [3, 1, { numberFormat: '#,##0' }],
  [4, 0, { bold: true }],
  [4, 1, { numberFormat: '#,##0' }],
  [5, 0, { bold: true }],
  [5, 1, { numberFormat: 'percent' }],
  [6, 0, { bold: true }],
  [8, 0, { bold: true, bgcolor: '#eef5f0' }],
  [9, 5, { bold: true, bgcolor: '#eef5f0' }],
  [10, 5, { bold: true }],
  [11, 5, { bold: true }],
  [12, 5, { bold: true }],
  [14, 0, { bold: true, bgcolor: '#f2f2f2' }],
  [14, 1, { bold: true, bgcolor: '#f2f2f2' }],
  [14, 2, { bold: true, bgcolor: '#f2f2f2' }],
  [14, 3, { bold: true, bgcolor: '#f2f2f2' }],
  [14, 4, { bold: true, bgcolor: '#f2f2f2' }],
];
