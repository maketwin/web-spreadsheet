import { Modal } from 'antd';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Store } from '../../src/store/Store';
import { PlatformPanel } from '../../src/platform/PlatformPanel';
import { buildBundle, importBundleFile, type ReproBundle } from '../../src/platform/bundle';
import { MockHub } from '../../src/platform/MockHub';
import type { ApiRule, MockProject } from '../../src/platform/types';

const hostProject = (): MockProject => ({
  name: '宿主项目',
  interfaces: [{ id: 'i1', name: '接口', method: 'GET', urlPattern: '/api/x', fallback: 'error' }],
  rules: [
    { id: 'r1', interfaceId: 'i1', name: '静态规则', matchers: {}, response: { kind: 'static', body: 1 }, fault: 'none', enabled: true, priority: 10 },
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
  priority: 20,
});

const projectFile = (project: MockProject): File =>
  new File([JSON.stringify({ version: 1, project, activeScenarioId: null })], 'import.ssp.json', { type: 'application/json' });

const projectInput = (): HTMLInputElement =>
  document.querySelector('input[accept=".json,.ssp.json,application/json"]') as HTMLInputElement;

const bundleInput = (): HTMLInputElement =>
  document.querySelector('input[accept=".json,application/json"]') as HTMLInputElement;

async function importBundle(hub: MockHub, store: Store): Promise<ReproBundle> {
  const file = new File([JSON.stringify(buildBundle(hub, store))], 'b.repro.json', { type: 'application/json' });
  return importBundleFile(file);
}

describe('导入确认：脚本出参规则须用户信任后生效', () => {
  afterEach(() => {
    Modal.destroyAll();
    document.body.innerHTML = '';
  });

  it('含脚本的项目文件：先弹确认，取消则不应用', async () => {
    const hub = new MockHub(hostProject());
    const store = new Store();
    render(<PlatformPanel hub={hub} store={store} />);

    const imported = { ...hostProject(), name: '外来项目', rules: [hostProject().rules[0]!, scriptRule('imp-script')] };
    await act(async () => {
      fireEvent.change(projectInput(), { target: { files: [projectFile(imported)] } });
    });
    expect(await screen.findByText(/将执行 1 段来自该文件的脚本/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /取\s*消/ }));
    await waitFor(() => expect(screen.queryByText(/将执行/)).toBeNull());
    expect(hub.project.name).toBe('宿主项目');
    expect(hub.project.rules.some((r) => r.id === 'imp-script')).toBe(false);
  });

  it('确认"信任并导入"后项目才被应用', async () => {
    const hub = new MockHub(hostProject());
    const store = new Store();
    render(<PlatformPanel hub={hub} store={store} />);

    const imported = { ...hostProject(), name: '外来项目', rules: [hostProject().rules[0]!, scriptRule('imp-script'), scriptRule('imp-script-2')] };
    await act(async () => {
      fireEvent.change(projectInput(), { target: { files: [projectFile(imported)] } });
    });
    expect(await screen.findByText(/将执行 2 段来自该文件的脚本/)).toBeInTheDocument();

    fireEvent.click(screen.getByText('信任并导入'));
    await waitFor(() => expect(hub.project.name).toBe('外来项目'));
    expect(hub.project.rules.filter((r) => r.response.kind === 'script')).toHaveLength(2);
  });

  it('确认框默认焦点在"取消"上：autoFocusButton 必须是 cancel（回车不能直接信任并导入）', async () => {
    const confirmSpy = vi.spyOn(Modal, 'confirm');
    try {
      const hub = new MockHub(hostProject());
      const store = new Store();
      render(<PlatformPanel hub={hub} store={store} />);

      const imported = { ...hostProject(), name: '外来项目', rules: [hostProject().rules[0]!, scriptRule('imp-script')] };
      await act(async () => {
        fireEvent.change(projectInput(), { target: { files: [projectFile(imported)] } });
      });
      expect(await screen.findByText(/将执行 1 段来自该文件的脚本/)).toBeInTheDocument();

      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(confirmSpy.mock.calls[0]?.[0]).toMatchObject({ autoFocusButton: 'cancel', okText: '信任并导入', cancelText: '取消' });
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it('不含脚本的项目保持原行为：直接应用，不弹确认', async () => {
    const hub = new MockHub(hostProject());
    const store = new Store();
    render(<PlatformPanel hub={hub} store={store} />);

    const imported = { ...hostProject(), name: '干净项目' };
    await act(async () => {
      fireEvent.change(projectInput(), { target: { files: [projectFile(imported)] } });
    });
    await waitFor(() => expect(hub.project.name).toBe('干净项目'));
    expect(screen.queryByText(/将执行/)).toBeNull();
    expect(screen.queryByText('信任并导入')).toBeNull();
  });

  it('含脚本的复现包同样先确认，取消则工作簿与项目都不动', async () => {
    const sourceHub = new MockHub({ ...hostProject(), name: '包内项目', rules: [hostProject().rules[0]!, scriptRule('imp-script')] });
    const sourceStore = new Store();
    sourceStore.setCell(1, 1, { text: '包内值', value: '包内值' });
    const bundle = await importBundle(sourceHub, sourceStore);

    const hub = new MockHub(hostProject());
    const store = new Store();
    store.setCell(1, 1, { text: '宿主值', value: '宿主值' });
    render(<PlatformPanel hub={hub} store={store} />);

    fireEvent.click(screen.getByRole('button', { name: '时间线' }));
    await act(async () => {
      fireEvent.change(bundleInput(), { target: { files: [new File([JSON.stringify(bundle)], 'b.repro.json', { type: 'application/json' })] } });
    });
    expect(await screen.findByText(/将执行 1 段来自该文件的脚本/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /取\s*消/ }));
    await waitFor(() => expect(screen.queryByText(/将执行/)).toBeNull());
    expect(store.getCell(1, 1)?.text).toBe('宿主值');
    expect(hub.project.name).toBe('宿主项目');
  });

  it('确认后复现包整体应用（项目与工作簿一起换）', async () => {
    const sourceHub = new MockHub({ ...hostProject(), name: '包内项目', rules: [hostProject().rules[0]!, scriptRule('imp-script')] });
    const sourceStore = new Store();
    sourceStore.setCell(1, 1, { text: '包内值', value: '包内值' });
    const bundle = await importBundle(sourceHub, sourceStore);

    const hub = new MockHub(hostProject());
    const store = new Store();
    store.setCell(1, 1, { text: '宿主值', value: '宿主值' });
    render(<PlatformPanel hub={hub} store={store} />);

    fireEvent.click(screen.getByRole('button', { name: '时间线' }));
    await act(async () => {
      fireEvent.change(bundleInput(), { target: { files: [new File([JSON.stringify(bundle)], 'b.repro.json', { type: 'application/json' })] } });
    });
    expect(await screen.findByText(/将执行 1 段来自该文件的脚本/)).toBeInTheDocument();

    fireEvent.click(screen.getByText('信任并导入'));
    await waitFor(() => expect(hub.project.name).toBe('包内项目'));
    expect(store.getCell(1, 1)?.text).toBe('包内值');
  });
});
