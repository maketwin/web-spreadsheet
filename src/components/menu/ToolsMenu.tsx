import { Menu } from 'antd';
import type { FC } from 'react';
import type { MenuActions } from './types';

/** Tools menu kept for API compatibility; no unimplemented entries. */
export interface ToolsMenuProps { readonly actions: MenuActions }

export const ToolsMenu: FC<ToolsMenuProps> = () => <Menu selectable={false} items={[]} />;
