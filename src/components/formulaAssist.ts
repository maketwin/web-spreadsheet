import { useState } from 'react';
import { FUNCTION_CATALOG, autoCompleteNames } from '../formula/functionCatalog';

export interface AssistSuggestion {
  readonly items: readonly string[];
  readonly active: number;
  /** Caret range in the editor value the completion will replace. */
  readonly from: number;
  readonly to: number;
}

export interface AssistSignature {
  readonly name: string;
  readonly sig: string;
  readonly desc: string;
  /** 0-based index of the argument the caret sits in. */
  readonly argIndex: number;
}

const PALETTE = ['#e67c73', '#33b679', '#7986cb', '#f4511e', '#039be5', '#8e24aa', '#c0ca33'];

/** Strip string literals so quotes/commas inside text do not confuse the
 * paren scanner and reference regexes. */
function stripLiterals(value: string): string {
  return value.replace(/"(?:[^"]|"")*"/g, (m) => '"'.repeat(m.length));
}

function colToIndex(token: string): number {
  let n = 0;
  for (const ch of token.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export interface FormulaAssist {
  readonly suggestions: AssistSuggestion | null;
  readonly signature: AssistSignature | null;
  /** Recompute suggestion list + signature tip after an edit. */
  afterChange: (value: string, caret: number) => void;
  /** Returns true when the key was consumed by the suggestion list. */
  onKeyDown: (key: string, currentValue: string, caret: number, setValue: (value: string, caret: number) => void) => boolean;
  dismiss: () => void;
}

/** Formula AutoComplete + signature tooltip state machine for the cell editor. */
export function useFormulaAssist(): FormulaAssist {
  const [suggestions, setSuggestions] = useState<AssistSuggestion | null>(null);
  const [signature, setSignature] = useState<AssistSignature | null>(null);

  const afterChange = (value: string, caret: number): void => {
    if (!value.startsWith('=')) {
      setSuggestions(null);
      setSignature(null);
      return;
    }
    const head = stripLiterals(value.slice(0, caret));

    // Signature tooltip: innermost unclosed function before the caret.
    let depth = 0;
    let last: { name: string; depth: number; commas: number } | undefined;
    for (let i = 0; i < head.length; i += 1) {
      const ch = head[i];
      if (ch === '"') {
        i += 1;
        while (i < head.length) {
          if (head[i] === '"') {
            if (head[i + 1] === '"') { i += 2; continue; }
            break;
          }
          i += 1;
        }
      } else if (ch === '(') {
        const fnName = head.slice(0, i).match(/([A-Za-z][A-Za-z0-9.]*)$/)?.[1];
        depth += 1;
        const doc = fnName !== undefined ? FUNCTION_CATALOG.get(fnName.toUpperCase()) : undefined;
        last = fnName !== undefined && doc !== undefined
          ? { name: fnName.toUpperCase(), depth, commas: 0 }
          : undefined;
      } else if (ch === ')') {
        depth -= 1;
        if (last !== undefined && depth < last.depth) last = undefined;
      } else if ((ch === ',' || ch === ';') && last !== undefined && depth === last.depth) {
        last.commas += 1;
      }
    }
    if (last !== undefined) {
      const doc = FUNCTION_CATALOG.get(last.name);
      if (doc !== undefined) setSignature({ name: last.name, sig: doc.sig, desc: doc.desc, argIndex: last.commas });
      else setSignature(null);
    } else {
      setSignature(null);
    }

    // Suggestions: a trailing identifier right after = ( , operator — not after ).
    const token = head.match(/([A-Za-z][A-Za-z0-9.]*)$/)?.[1];
    if (token === undefined) {
      setSuggestions(null);
      return;
    }
    const from = caret - token.length;
    const prev = from >= 1 ? head[from - 1] ?? '' : '';
    const boundaryOk = from === 1 || '=(,+-*/&<>^% '.includes(prev);
    const query = token.toUpperCase();
    const items = boundaryOk && query.length >= 1
      ? autoCompleteNames().filter((name) => name.startsWith(query) && name !== query).slice(0, 8)
      : [];
    setSuggestions(items.length > 0 ? { items, active: 0, from, to: caret } : null);
  };

  const onKeyDown = (key: string, currentValue: string, caret: number, setValue: (value: string, caret: number) => void): boolean => {
    if (suggestions === null) return false;
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      const delta = key === 'ArrowDown' ? 1 : -1;
      setSuggestions({ ...suggestions, active: (suggestions.active + delta + suggestions.items.length) % suggestions.items.length });
      return true;
    }
    if (key === 'Tab' || key === 'Enter') {
      const name = suggestions.items[suggestions.active] ?? suggestions.items[0];
      if (name !== undefined) {
        const inserted = name + '(';
        const next = currentValue.slice(0, suggestions.from) + inserted + currentValue.slice(caret);
        const caretAfter = suggestions.from + inserted.length;
        setValue(next, caretAfter);
        afterChange(next, caretAfter);
      }
      setSuggestions(null);
      return true;
    }
    if (key === 'Escape') {
      setSuggestions(null);
      return true;
    }
    return false;
  };

  return {
    suggestions,
    signature,
    afterChange,
    onKeyDown,
    dismiss: () => setSuggestions(null),
  };
}

/** Cell-reference token inside a formula: optional anchors, 1–3 letters, digits. */
const REF_TOKEN = /[$]?([A-Za-z]{1,3})[$]?(\d{1,7})(?::[$]?([A-Za-z]{1,3})[$]?(\d{1,7}))?/g;

/** Parse cell/range references out of a formula string (string literals masked).
 * Tokens that are part of longer identifiers or function calls are skipped. */
export function parseFormulaRefs(value: string): readonly { x1: number; y1: number; x2: number; y2: number }[] {
  const stripped = stripLiterals(value);
  const ranges: { x1: number; y1: number; x2: number; y2: number }[] = [];
  for (const match of stripped.matchAll(REF_TOKEN)) {
    const after = stripped[match.index + match[0].length] ?? '';
    // Part of a function call like LOG10( — not a cell reference.
    if (/[A-Za-z0-9(]/.test(after)) continue;
    const x1 = colToIndex(match[1]!);
    const y1 = Number(match[2]) - 1;
    const x2 = match[3] !== undefined ? colToIndex(match[3]) : x1;
    const y2 = match[4] !== undefined ? Number(match[4]) - 1 : y1;
    ranges.push({ x1: Math.min(x1, x2), y1: Math.min(y1, y2), x2: Math.max(x1, x2), y2: Math.max(y1, y2) });
  }
  return ranges;
}

export const REF_HIGHLIGHT_PALETTE = PALETTE;
