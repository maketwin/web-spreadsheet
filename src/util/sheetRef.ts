/** Quote a sheet name the way Excel does when it is not a plain identifier. */
export function quoteSheetName(name: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return name;
  return `'${name.replaceAll("'", "''")}'`;
}

function namesEqual(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** Length of an A1 / A1:B2 / name token starting at `i`, or 0 when there is none. */
function refLength(formula: string, i: number): number {
  const rest = formula.slice(i);
  const cell = /^(\$?[A-Za-z]{1,3}\$?\d+)(?::\$?[A-Za-z]{1,3}\$?\d+)?/.exec(rest);
  if (cell !== null) return cell[0].length;
  const ident = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(rest);
  return ident !== null ? ident[0].length : 0;
}

/**
 * Rewrite or strip `Sheet!ref` outside of string literals.
 * `replacement === null` deletes the ref (sheet was removed) and writes `#REF!`.
 */
export function mapSheetRefs(formula: string, fromName: string, replacement: string | null): string {
  if (!formula.includes('!')) return formula;
  let out = '';
  let i = 0;
  while (i < formula.length) {
    const ch = formula[i]!;
    if (ch === '"') {
      const start = i;
      i += 1;
      while (i < formula.length) {
        if (formula[i] === '"') {
          if (formula[i + 1] === '"') { i += 2; continue; }
          i += 1;
          break;
        }
        i += 1;
      }
      out += formula.slice(start, i);
      continue;
    }
    const quoted = readQuotedSheet(formula, i);
    if (quoted !== undefined && formula[quoted.end] === '!') {
      const refEnd = quoted.end + 1 + refLength(formula, quoted.end + 1);
      if (namesEqual(quoted.name, fromName)) {
        out += replacement === null ? '#REF!' : `${quoteSheetName(replacement)}!${formula.slice(quoted.end + 1, refEnd)}`;
      } else {
        out += formula.slice(i, refEnd);
      }
      i = refEnd;
      continue;
    }
    const bare = /^([A-Za-z_\u0080-\uFFFF][A-Za-z0-9_\u0080-\uFFFF]*)!/.exec(formula.slice(i));
    if (bare !== null) {
      const bang = i + bare[0].length;
      const refEnd = bang + refLength(formula, bang);
      if (namesEqual(bare[1]!, fromName)) {
        out += replacement === null ? '#REF!' : `${quoteSheetName(replacement)}!${formula.slice(bang, refEnd)}`;
      } else {
        out += formula.slice(i, refEnd);
      }
      i = refEnd;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

function readQuotedSheet(formula: string, i: number): { readonly name: string; readonly end: number } | undefined {
  if (formula[i] !== "'") return undefined;
  let name = '';
  let j = i + 1;
  while (j < formula.length) {
    if (formula[j] === "'") {
      if (formula[j + 1] === "'") { name += "'"; j += 2; continue; }
      return { name, end: j + 1 };
    }
    name += formula[j] ?? '';
    j += 1;
  }
  return undefined;
}
