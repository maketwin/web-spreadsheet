import type { ReactNode } from 'react';

export function shortcutLabel(text: string, shortcut?: string): ReactNode {
  if (shortcut === undefined) return text;
  return <span className="ss-menu-label"><span>{text}</span><kbd>{shortcut}</kbd></span>;
}
