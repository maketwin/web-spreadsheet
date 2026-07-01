import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MenuBar } from '../../../src/components/menu/MenuBar';
import { Range } from '../../../src/selection/Range';
import { Store } from '../../../src/store/Store';

describe('MenuBar', () => {
  it('renders 7 menu items', () => {
    render(<MenuBar store={new Store()} selected={Range.single(0, 0).toAddress()} selectRange={() => undefined} clearRange={() => undefined} allRange={() => undefined} />);

    expect(screen.getByText('文件(F)')).toBeInTheDocument();
    expect(screen.getByText('编辑(E)')).toBeInTheDocument();
    expect(screen.getByText('视图(V)')).toBeInTheDocument();
    expect(screen.getByText('插入(I)')).toBeInTheDocument();
    expect(screen.getByText('格式(O)')).toBeInTheDocument();
    expect(screen.getByText('工具(T)')).toBeInTheDocument();
    expect(screen.getByText('帮助(H)')).toBeInTheDocument();
  });
});
