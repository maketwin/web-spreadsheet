/**
 * Mock 平台领域模型 —— 完整设计见 docs/design/mock-platform.md。
 *
 * 三条记录流共用一套时间线：操作流（用户做了什么）、流量流（接口来了什么）、
 * 场景流（环境怎么变的）。统一递增 seq，TrafficEvent.causedBy 指向引发它的
 * 时间线事件，构成因果链。
 */

export type HttpMethod = 'GET' | 'POST';

/**
 * 一个可被接管的接口。urlPattern 支持 {param} 路径参数，如 /api/orders/{id}。
 * upstream 配置后可"同步真实数据"：抓取该 URL（附加最近一次请求的 query）
 * 存为捕获快照，由 kind='capture' 的规则出参。
 */
export interface ApiInterface {
  readonly id: string;
  readonly name: string;
  readonly method: HttpMethod;
  readonly urlPattern: string;
  /** 规则全部未命中时的兜底行为：error 返回 #API!，empty 返回空。 */
  readonly fallback: 'error' | 'empty';
  /** 真实上游完整 URL（可相对路径，同源）。缺省 = 纯 mock。 */
  readonly upstream?: string;
  /**
   * 入参断言：不影响规则选择与出参，只校验"表格发出来的 query 是否正确"，
   * 违规记入流量并在时间线标红——让平台从"喂数据"升级为"验行为"。
   */
  readonly assertions?: readonly ApiAssertion[];
}

/** 入参断言条件：equals 精确相等或 oneOf 枚举（都缺省 = 只查 key 存在）。 */
export interface ApiAssertion {
  readonly key: string;
  readonly equals?: string;
  readonly oneOf?: readonly string[];
}

/** 入参匹配条件：query 参数精确匹配，'*' 表示任意值。 */
export interface RuleMatchers {
  readonly query?: Readonly<Record<string, string>>;
}

/** none 正常；error 模拟 500；timeout 模拟挂起超时（同步求值下效果同 error，流量里区分标注）。 */
export type FaultKind = 'none' | 'error' | 'timeout';

/** static 原样返回；template 渲染占位符；capture 返回真实上游捕获的快照；script 执行动态脚本。 */
export type ResponseKind = 'static' | 'template' | 'capture' | 'script';

export interface RuleResponse {
  /**
   * static：body 原样返回；template：body 内的 {{query.x}} / {{path.x}}
   * 占位符用本次入参渲染（整串占位符保留原始类型，混合串做字符串插值）；
   * capture：忽略 body，返回该接口最近一次真实捕获（未捕获时 #API!）；
   * script：body 是一段 JS，签名 `(req) => body`（req = { query, path }），
   * 返回值即出参——覆盖签名、分页、关联计算等动态逻辑。
   */
  readonly kind: ResponseKind;
  readonly body: unknown;
}

export interface ApiRule {
  readonly id: string;
  readonly interfaceId: string;
  readonly name: string;
  readonly matchers: RuleMatchers;
  readonly response: RuleResponse;
  readonly fault: FaultKind;
  /** fault ≠ none 时按概率触发（0~1，缺省 1 必发）。用稳定种子，回放可复现。 */
  readonly faultProbability?: number;
  /** 逻辑延迟毫秒：记入流量（回放按逻辑时间对账），不阻塞同步求值。 */
  readonly delayMs?: number;
  readonly enabled: boolean;
  /** 数字越小优先级越高。 */
  readonly priority: number;
}

/** 场景 = 每个接口在该场景下启用的规则（interfaceId -> ruleId）。 */
export interface Scenario {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly rules: Readonly<Record<string, string>>;
}

export interface MockProject {
  readonly name: string;
  readonly interfaces: readonly ApiInterface[];
  readonly rules: readonly ApiRule[];
  readonly scenarios: readonly Scenario[];
}

export type OpVia = 'user' | 'undo' | 'redo' | 'replay';

/** 可重放的操作载荷：复现包/回放引擎据此重建命令（不经过 undo 栈）。sheetId 缺省 = 当前活动表。 */
export type ReplayPayload =
  | { readonly kind: 'setCell'; readonly r: number; readonly c: number; readonly text: string; readonly sheetId?: string }
  | { readonly kind: 'insertRow' | 'deleteRow'; readonly r: number; readonly count: number; readonly sheetId?: string }
  | { readonly kind: 'insertCol' | 'deleteCol'; readonly c: number; readonly count: number; readonly sheetId?: string };

/** 流量来源：命中规则 / 真实捕获 / 未命中。 */
export type TrafficSource = 'rule' | 'capture' | 'miss';

export type TimelineEvent =
  | {
      readonly seq: number;
      readonly ts: number;
      readonly kind: 'op';
      readonly type: string;
      readonly via: OpVia;
      /** 动了哪里：单元格引用（B3）、行/列号、区间。未识别命令为 null。 */
      readonly target: string | null;
      /** 执行前的值（单元格命令才有；公式单元格显示公式）。 */
      readonly before: string | null;
      /** 执行后的值。 */
      readonly after: string | null;
      /** 可重放载荷（能从 args 重建命令的操作才有）。 */
      readonly replay: ReplayPayload | null;
    }
  | { readonly seq: number; readonly ts: number; readonly kind: 'scenario'; readonly from: string | null; readonly to: string }
  | {
      readonly seq: number;
      readonly ts: number;
      readonly kind: 'traffic';
      readonly interfaceId: string;
      readonly url: string;
      readonly query: Readonly<Record<string, string>>;
      readonly matchedRuleId: string | null;
      readonly source: TrafficSource;
      readonly scenarioId: string | null;
      readonly fault: FaultKind;
      /** 注入的逻辑延迟毫秒（来自规则 delayMs；回放按逻辑时间对账）。 */
      readonly delayMs: number | null;
      /** 入参断言/脚本的违规信息（空数组 = 无违规）。 */
      readonly violations: readonly string[];
      readonly response: unknown;
      readonly causedBy: number | null;
    };
