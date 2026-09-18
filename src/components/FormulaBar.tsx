import type { FC } from 'react';
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
}

export const FormulaBar: FC<FormulaBarProps> = ({ selected, value, onChange, onCommit, onGoTo }) => {
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
          if (event.key === 'Enter') { event.preventDefault(); onGoTo?.(nameInput); event.currentTarget.blur(); }
          if (event.key === 'Escape') { setEditingName(false); event.currentTarget.blur(); }
        }}
        onBlur={() => setEditingName(false)}
      />
      <span aria-hidden />
      <span className="ss-formula-fx" title="Insert function" aria-hidden>ƒx</span>
      <input
        className="ss-formula-input"
        aria-label="Formula bar"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onCommit();
          if (event.key === 'Escape') (event.target as HTMLInputElement).blur();
        }}
      />
    </div>
  );
};
