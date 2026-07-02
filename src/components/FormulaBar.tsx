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
  return <div className="ss-formula-bar">
    <div className="ss-formula-name" aria-label="Selected cell">{label}</div>
    <span className="ss-formula-fx">fx</span>
    <input className="ss-formula-input" aria-label="Formula bar" value={value} onChange={(event) => onChange(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') onCommit(); }} />
  </div>;
};
