import type { FC, MutableRefObject } from 'react';
import { useEffect, useState } from 'react';
import type { Selection } from '../selection/Selection';
import { selectionLabel } from '../selection/Selection';

export interface FormulaBarProps {
  readonly selected: Selection | null;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onCommit: () => void;
  /** Excel name box: jump to an A1 reference, range or defined name. */
  readonly onGoTo?: (input: string) => void;
  /** Ref to the formula input so char-level formatting can read its selection. */
  readonly inputRef?: MutableRefObject<HTMLInputElement | null>;
  /** Excel: Ctrl/Cmd+B/I/U with characters selected in the formula bar formats those characters. */
  readonly onCharStyleKey?: (key: 'bold' | 'italic' | 'underline') => void;
}

export const FormulaBar: FC<FormulaBarProps> = ({ selected, value, onChange, onCommit, onGoTo, inputRef, onCharStyleKey }) => {
  const label = selectionLabel(selected);
  const [nameInput, setNameInput] = useState(label);
  const [editingName, setEditingName] = useState(false);
  useEffect(() => { if (!editingName) setNameInput(label); }, [label, editingName]);
  return (
    <div className="ss-formula-bar">
      <input
        className="ss-formula-name"
        aria-label="Selected cell"
        title="名称框：输入 A1、B2:D5 或命名区域后回车跳转"
        value={editingName ? nameInput : label}
        onFocus={(event) => { setEditingName(true); setNameInput(label); requestAnimationFrame(() => event.target.select()); }}
        onChange={(event) => setNameInput(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); onGoTo?.(nameInput); }
          if (event.key === 'Escape') { setEditingName(false); event.currentTarget.blur(); }
        }}
        onBlur={() => setEditingName(false)}
      />
      <span aria-hidden />
      <span className="ss-formula-fx" title="Insert function" aria-hidden>ƒx</span>
      <input
        ref={inputRef}
        className="ss-formula-input"
        aria-label="Formula bar"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onCommit();
          if (event.key === 'Escape') (event.target as HTMLInputElement).blur();
          // Excel: Ctrl/Cmd+B/I/U with a selection in the formula bar formats those characters.
          if ((event.ctrlKey || event.metaKey) && !event.altKey) {
            const key = event.key.toLowerCase();
            if (key === 'b' || key === 'i' || key === 'u') {
              event.preventDefault();
              onCharStyleKey?.(key === 'b' ? 'bold' : key === 'i' ? 'italic' : 'underline');
            }
          }
        }}
        onBlur={(event) => {
          // Leaving the formula bar for the grid drops the char selection; toolbar
          // focus (selects/popovers) keeps it so the pending format can land.
          const next = event.relatedTarget as HTMLElement | null;
          if (next === null || next.closest('.ss-interaction-toolbar, .ss-menu-bar, .ant-dropdown, .ant-popover') === null) {
            const input = event.currentTarget;
            const pos = input.selectionEnd ?? input.value.length;
            input.setSelectionRange(pos, pos);
          }
        }}
      />
    </div>
  );
};
