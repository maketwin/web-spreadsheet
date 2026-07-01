import type { ChangeEvent, FC } from 'react';

export interface EditorProps {
  value?: string;
  visible?: boolean;
  onChange?: (value: string) => void;
  onCommit?: (value: string) => void;
}

export const Editor: FC<EditorProps> = ({ value = '', visible = true, onChange, onCommit }) => {
  if (!visible) return null;

  const handleChange = (event: ChangeEvent<HTMLInputElement>): void => {
    onChange?.(event.target.value);
  };

  const handleBlur = (event: ChangeEvent<HTMLInputElement>): void => {
    onCommit?.(event.target.value);
  };

  return (
    <input
      className="ss-editor"
      aria-label="Cell editor"
      value={value}
      onChange={handleChange}
      onBlur={handleBlur}
    />
  );
};
