import { afterEach, describe, expect, it, vi } from 'vitest';
import { MockHub } from '../../src/platform/MockHub';
import {
  clearPersistedProject,
  countScriptRules,
  importProjectFile,
  persistProject,
  restoreProject,
  validateProject,
  warnOncePersistFailed,
} from '../../src/platform/persistence';
import type { ApiRule, MockProject } from '../../src/platform/types';

const makeProject = (): MockProject => ({
  name: '校验项目',
  interfaces: [{ id: 'i1', name: '接口', method: 'GET', urlPattern: '/api/x', fallback: 'error' }],
  rules: [
    { id: 'r1', interfaceId: 'i1', name: '规则', matchers: {}, response: { kind: 'static', body: 1 }, fault: 'none', enabled: true, priority: 10 },
  ],
  scenarios: [{ id: 's1', name: '场景', description: '', rules: { i1: 'r1' } }],
});

const scriptRule = (id: string): ApiRule => ({
  id,
  interfaceId: 'i1',
  name: '脚本规则',
  matchers: {},
  response: { kind: 'script', body: 'return req.query;' },
  fault: 'none',
  enabled: true,
  priority: 10,
});

describe('validateProject 形状校验', () => {
  it('合法项目原样通过', () => {
    expect(validateProject(makeProject())).toMatchObject({ name: '校验项目' });
  });

  it('面板会直读的接口字段形状不对时拒绝（method/fallback/upstream/assertions）', () => {
    const bad = (patch: Record<string, unknown>): unknown => {
      const p = makeProject();
      return { ...p, interfaces: [{ ...p.interfaces[0], ...patch }] };
    };
    expect(() => validateProject(bad({ method: 'PUT' }))).toThrow('method 必须是 GET 或 POST');
    expect(() => validateProject(bad({ fallback: 'boom' }))).toThrow('fallback 必须是 error 或 empty');
    expect(() => validateProject(bad({ upstream: 123 }))).toThrow('upstream 必须是字符串');
    expect(() => validateProject(bad({ assertions: 'nope' }))).toThrow('断言');
  });

  it('面板会直读的规则字段缺失时拒绝（面板原来会在渲染时崩溃）', () => {
    const bad = (patch: Record<string, unknown>): unknown => {
      const p = makeProject();
      const base = p.rules[0] as unknown as Record<string, unknown>;
      return { ...p, rules: [{ ...base, ...patch }] };
    };
    expect(() => validateProject(bad({ name: undefined }))).toThrow('缺少名称');
    expect(() => validateProject(bad({ matchers: undefined }))).toThrow('matchers');
    expect(() => validateProject(bad({ response: { kind: 'nope', body: 1 } }))).toThrow('response.kind');
    expect(() => validateProject(bad({ response: {} }))).toThrow('response.kind');
    expect(() => validateProject(bad({ fault: 'boom' }))).toThrow('fault 必须是 none/error/timeout');
    expect(() => validateProject(bad({ enabled: 'yes' }))).toThrow('enabled');
    expect(() => validateProject(bad({ priority: 'top' }))).toThrow('priority 必须是数字');
  });

  it('持久化存档里混入坏接口时 restore 静默回落到 null（而不是崩溃）', () => {
    localStorage.setItem('ssp:project:v1', JSON.stringify({
      version: 1,
      project: { ...makeProject(), interfaces: [{ id: 'i1', name: '接口', method: 'PUT', urlPattern: '/api/x', fallback: 'error' }] },
      activeScenarioId: null,
    }));
    expect(restoreProject()).toBeNull();
    clearPersistedProject();
  });
});

describe('countScriptRules（导入确认的判定输入）', () => {
  it('脚本出参规则计数：无脚本为 0，有脚本按条数', () => {
    expect(countScriptRules(makeProject())).toBe(0);
    const withScripts: MockProject = { ...makeProject(), rules: [makeProject().rules[0]!, scriptRule('r2'), scriptRule('r3')] };
    expect(countScriptRules(withScripts)).toBe(2);
  });

  it('导入文件后能数出脚本段数（面板据此决定是否弹确认）', async () => {
    const payload = { version: 1, project: { ...makeProject(), rules: [makeProject().rules[0]!, scriptRule('r2')] }, activeScenarioId: null };
    const file = new File([JSON.stringify(payload)], 'p.ssp.json', { type: 'application/json' });
    const imported = await importProjectFile(file);
    expect(countScriptRules(imported.project)).toBe(1);
  });
});

describe('persistProject 失败可见化', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    clearPersistedProject();
    document.body.innerHTML = '';
  });

  it('保存成功返回 true 且落盘', () => {
    const hub = new MockHub(makeProject());
    expect(persistProject(hub)).toBe(true);
    expect(localStorage.getItem('ssp:project:v1')).not.toBeNull();
  });

  it('隐私模式/超配额（setItem 抛异常）返回 false 而不抛出', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => { throw new Error('QuotaExceededError'); },
      removeItem: () => undefined,
    });
    const hub = new MockHub(makeProject());
    expect(persistProject(hub)).toBe(false);
  });

  it('保存失败时提示条只出现一次，超时后自动移除', () => {
    vi.useFakeTimers();
    warnOncePersistFailed();
    expect(document.querySelectorAll('.ssp-import-error')).toHaveLength(1);
    // 同一页面的后续失败不再重复打扰
    warnOncePersistFailed();
    expect(document.querySelectorAll('.ssp-import-error')).toHaveLength(1);
    vi.advanceTimersByTime(8000);
    expect(document.querySelectorAll('.ssp-import-error')).toHaveLength(0);
  });
});
