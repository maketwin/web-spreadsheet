/** Supported validation types. */
export type ValidationType = 'list' | 'integer' | 'date';

/** A validation rule applied to a cell or range. */
export type ValidationRule =
  | { type: 'list'; values: readonly string[] }
  | { type: 'integer'; min: number; max: number }
  | { type: 'date'; minDate: string; maxDate: string };
