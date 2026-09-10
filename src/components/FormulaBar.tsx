import type { FC } from 'react';
import type { Selection } from '../selection/Selection';
import { selectionLabel } from '../selection/Selection';

export interface FormulaBarProps {
  readonly selected: Selection | null;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onCommit: () => void;
}

export const FormulaBar: FC<FormulaBarProps> = ({ selected, value, onChange, onCommit }) => {
  const label = selectionLabel(selected);
  return (
    <div className="ss-formula-bar">
      <div className="ss-formula-name" aria-label="Selected cell">{label || 'A1'}</div>
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
