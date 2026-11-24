import { render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { ReactNode } from 'react';
import { PanelErrorBoundary } from '../../src/platform/PlatformPanel';
import { clearPersistedProject } from '../../src/platform/persistence';

/** 渲染即崩的子组件（模拟坏数据把面板打崩）。 */
function Bomb(): ReactNode {
  throw new Error('坏数据炸了');
}

describe('PanelErrorBoundary', () => {
  let errorSpy: MockInstance;
  beforeEach(() => {
    // 崩溃本身与 jsdom 缺失的导航 API 都会打 console.error，测试里静音
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    localStorage.setItem('ssp:project:v1', '{"version":1}');
  });
  afterEach(() => {
    errorSpy.mockRestore();
    clearPersistedProject();
    document.body.innerHTML = '';
  });

  it('子组件崩溃时显示可读提示与两个恢复动作，而不是白屏', () => {
    render(<PanelErrorBoundary><Bomb /></PanelErrorBoundary>);
    expect(screen.getByText('面板渲染出错')).toBeInTheDocument();
    expect(screen.getByText(/坏数据炸了/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新加载' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重置并重新加载' })).toBeInTheDocument();
  });

  it('"重置并重新加载"先清掉持久化项目再刷新（否则刷新后又从坏存档恢复，陷入循环）', () => {
    render(<PanelErrorBoundary><Bomb /></PanelErrorBoundary>);
    fireEvent.click(screen.getByRole('button', { name: '重置并重新加载' }));
    expect(localStorage.getItem('ssp:project:v1')).toBeNull();
  });

  it('"重新加载"保留持久化项目（崩溃未必是坏存档造成的）', () => {
    render(<PanelErrorBoundary><Bomb /></PanelErrorBoundary>);
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
    expect(localStorage.getItem('ssp:project:v1')).not.toBeNull();
  });

  it('子组件正常时原样渲染', () => {
    render(<PanelErrorBoundary><div>面板本体</div></PanelErrorBoundary>);
    expect(screen.getByText('面板本体')).toBeInTheDocument();
  });
});
