/**
 * Post-build smoke check for the published artifacts. Run after `pnpm build`
 * (`pnpm check:dist`); CI runs it on every build.
 *
 * The package is loaded the way consumers load it — through its own `exports`
 * map — so a stale target or a wrong condition fails here instead of in a host
 * app. Checked:
 *  - every target named by main / module / types / exports exists;
 *  - the ESM and CommonJS forms of `.` export the same non-empty set of names
 *    (the UMD bundle has to be `.cjs`: this package is `"type": "module"`, so
 *    Node parses a `.js` UMD file as ESM and `require()` returns nothing);
 *  - the type entries exist, their relative imports all resolve, and they
 *    declare every name the runtime exports;
 *  - `./core` loads without the UI stack and imports no package at all;
 *  - `./styles.css` kept the layout rules, the theme tokens and every class
 *    the source stylesheets style, and is the only stylesheet built;
 *  - the xlsx worker chunk is emitted and both entry bundles point at it.
 *
 * Exit code is 1 when any check fails.
 */

/* global console, process */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const requireFromScript = createRequire(import.meta.url);

const failures = [];

function check(ok, message) {
  console.log(`${ok ? 'ok   ' : 'FAIL '} ${message}`);
  if (!ok) failures.push(message);
}

/** Flattens an `exports` value into `[conditions, target]` pairs. */
function exportTargets(target, conditions = []) {
  if (typeof target === 'string') return [[conditions, target]];
  return Object.entries(target).flatMap(([condition, next]) =>
    exportTargets(next, [...conditions, condition]),
  );
}

// ── 1. Every entry target exists ────────────────────────────────────────────
for (const [field, target] of [['main', pkg.main], ['module', pkg.module], ['types', pkg.types]]) {
  check(existsSync(resolve(root, target)), `${field} -> ${target}`);
}
for (const [subpath, target] of Object.entries(pkg.exports)) {
  for (const [conditions, file] of exportTargets(target)) {
    const label = conditions.length > 0 ? `exports["${subpath}"] ${conditions.join(', ')}` : `exports["${subpath}"]`;
    check(existsSync(resolve(root, file)), `${label} -> ${file}`);
  }
}

// ── 2. ESM and CommonJS forms of the root entry ─────────────────────────────
const esm = await import(pkg.name);
const esmNames = Object.keys(esm).sort();
check(esmNames.length > 0, `"." ESM import exports ${esmNames.length} names`);
check(
  fileURLToPath(import.meta.resolve(pkg.name)) === resolve(root, pkg.exports['.'].import),
  `"." ESM import resolves through exports to ${pkg.exports['.'].import}`,
);

const cjs = requireFromScript(pkg.name);
const cjsNames = Object.keys(cjs).filter((name) => name !== '__esModule').sort();
check(cjsNames.length > 0, `"." CommonJS require exports ${cjsNames.length} names`);
check(
  requireFromScript.resolve(pkg.name) === resolve(root, pkg.exports['.'].require),
  `"." CommonJS require resolves through exports to ${pkg.exports['.'].require}`,
);
check(
  esmNames.length === cjsNames.length && esmNames.every((name, i) => name === cjsNames[i]),
  `"." CommonJS and ESM export the same names`,
);

// ── 3. Type entries ─────────────────────────────────────────────────────────
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '');

/** Resolves a relative declaration import the way TypeScript does. */
function resolveDeclaration(fromFile, specifier) {
  const base = resolve(dirname(fromFile), specifier);
  return [`${base}.d.ts`, `${base}.ts`, base, resolve(base, 'index.d.ts')]
    .find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
}

/**
 * Walks the declaration graph reachable from `entry`. Returns the value names
 * it exports and every relative import on the way that resolves to nothing.
 */
function readTypes(entry) {
  const namesByFile = new Map();
  const broken = [];

  function valueNamesOf(file) {
    const cached = namesByFile.get(file);
    if (cached !== undefined) return cached;
    const names = new Set();
    namesByFile.set(file, names);
    const text = stripComments(readFileSync(file, 'utf8'));

    for (const match of text.matchAll(/\bfrom\s+["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/g)) {
      const specifier = match[1] ?? match[2];
      if (specifier === undefined || !specifier.startsWith('.')) continue;
      const target = resolveDeclaration(file, specifier);
      if (target === undefined) {
        broken.push(`${specifier} (imported by ${file})`);
        continue;
      }
      valueNamesOf(target);
    }

    for (const match of text.matchAll(/export declare (?:abstract )?(?:class|function|const|let|var|enum) (\w+)/g)) {
      names.add(match[1]);
    }
    for (const match of text.matchAll(/export \* as (\w+) from/g)) {
      names.add(match[1]);
    }
    // With a `from` clause, or a local list — the bundled declaration renames
    // on re-export (`declare class Range_2 { … } export { Range_2 as Range }`).
    for (const match of text.matchAll(/export (type )?\{([^}]*)\}(?:\s*from ["']([^"']+)["'])?/g)) {
      if (match[1] !== undefined) continue; // `export type { … }`: no runtime name
      for (const item of match[2].split(',')) {
        const parts = item.trim().split(/\s+/);
        if (parts[0] === 'type' || parts[0] === '') continue;
        names.add(parts[parts.length - 1]);
      }
    }
    for (const match of text.matchAll(/export \* from ["']([^"']+)["']/g)) {
      const target = resolveDeclaration(file, match[1]);
      if (target === undefined) {
        broken.push(`${match[1]} (imported by ${file})`);
        continue;
      }
      for (const name of valueNamesOf(target)) {
        if (name !== 'default') names.add(name);
      }
    }
    return names;
  }

  const names = valueNamesOf(resolve(root, entry));
  return { names, broken };
}

function checkTypes(label, typesEntry, runtimeNames) {
  const { names, broken } = readTypes(typesEntry);
  check(broken.length === 0, `${label} type declarations resolve every relative import${broken.length ? ` (missing: ${broken.join(', ')})` : ''}`);
  const undeclared = runtimeNames.filter((name) => !names.has(name));
  check(undeclared.length === 0, `${label} type declarations cover all ${runtimeNames.length} runtime exports${undeclared.length ? ` (undeclared: ${undeclared.join(', ')})` : ''}`);
}

checkTypes('"."', pkg.exports['.'].types, esmNames);

// ── 4. Headless core entry ──────────────────────────────────────────────────
const core = await import(`${pkg.name}/core`);
const coreNames = Object.keys(core).sort();
check(coreNames.length > 0, `"./core" ESM import exports ${coreNames.length} names`);
for (const name of ['Store', 'FormulaEngine', 'CommandManager', 'EventBus', 'CanvasRenderer']) {
  check(name in core, `"./core" exports ${name}`);
}
for (const name of ['Spreadsheet', 'Toolbar', 'MenuBar', 'FloatingChart', 'Sparkline', 'loadWorkbook', 'DEFAULT_ID']) {
  check(!(name in core), `"./core" keeps the UI / persistence export ${name} out`);
}
checkTypes('"./core"', pkg.exports['./core'].types, coreNames);

// Module syntax only: `… from "x"`, a statement-initial `import "x"`, `import("x")`.
// The looser `import "…"` spelling also matches string content such as `"csv:import"`.
const MODULE_SPECIFIER = /[\w}*]\s*from\s*["']([^"']+)["']|(?:^|[;{}])\s*import\s*["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/gm;

const coreJs = readFileSync(resolve(root, pkg.exports['./core'].import), 'utf8');
const bareSpecifiers = [...coreJs.matchAll(MODULE_SPECIFIER)]
  .map((match) => match[1] ?? match[2] ?? match[3])
  .filter((specifier) => !specifier.startsWith('.'));
check(bareSpecifiers.length === 0, `"./core" imports no package${bareSpecifiers.length ? ` (found: ${bareSpecifiers.join(', ')})` : ''}`);

// ── 5. Stylesheet ───────────────────────────────────────────────────────────
const stripCssComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '');

/** Splits CSS into `[selector, declarations]` pairs; rules inside at-rules are flattened. */
function cssRules(text) {
  return [...stripCssComments(text).matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((match) => [match[1].trim(), match[2].split(';').map((d) => d.replace(/\s+/g, '')).filter(Boolean)]);
}
const classesOf = (rules) => new Set(rules.flatMap(([selector]) => selector.match(/\.[\w-]+/g) ?? []).map((name) => name.slice(1)));

const distCss = readFileSync(resolve(root, pkg.exports['./styles.css']), 'utf8');
const distRules = cssRules(distCss);

const LAYOUT_RULES = [
  ['.ss-root', ['display:flex', 'flex-direction:column', 'width:100%', 'height:100%']],
  ['.ss-canvas-wrap', ['position:relative', 'flex:1', 'min-height:0', 'overflow:hidden']],
  ['.ss-canvas', ['width:100%', 'height:100%', 'display:block', 'touch-action:none']],
  ['.ss-editor-overlay', ['position:absolute']],
];
for (const [selector, wanted] of LAYOUT_RULES) {
  const declared = distRules
    .filter(([prelude]) => prelude.split(',').some((part) => part.trim() === selector))
    .flatMap(([, declarations]) => declarations);
  for (const declaration of wanted) {
    check(declared.includes(declaration), `styles.css: ${selector} declares ${declaration}`);
  }
}

const TOKENS = ['--ss-bg', '--ss-text', '--ss-text-light', '--ss-border', '--ss-accent', '--ss-menu-bg', '--ss-selected', '--ss-header-bg', '--ss-toolbar-bg', '--ss-status-bg', '--ss-status-text'];
const themeTokens = (selector) => {
  const declared = distRules
    .filter(([prelude]) => prelude.replace(/["'\s]/g, '') === selector)
    .flatMap(([, declarations]) => declarations);
  return TOKENS.filter((token) => !declared.some((declaration) => declaration.startsWith(`${token}:`)));
};
check(themeTokens(':root').length === 0, `styles.css: light theme defines the ${TOKENS.length} layout tokens`);
check(themeTokens(':root[data-spreadsheet-theme=dark]').length === 0, 'styles.css: dark theme defines the layout tokens');

// Source of truth: the stylesheet the root entry imports, with its @imports inlined.
const sourceEntry = resolve(root, 'src/styles/spreadsheet.css');
const entryText = readFileSync(sourceEntry, 'utf8');
const importedFiles = [...entryText.matchAll(/@import\s+["']([^"']+)["']/g)];
const sourceText = [
  entryText.replace(/@import\s+["'][^"']+["'];?/g, ''),
  ...importedFiles.map((match) => readFileSync(resolve(dirname(sourceEntry), match[1]), 'utf8')),
].join('\n');
const sourceClasses = classesOf(cssRules(sourceText));
const distClasses = classesOf(distRules);
const missingClasses = [...sourceClasses].filter((name) => !distClasses.has(name));
check(
  sourceClasses.size > 0 && missingClasses.length === 0,
  `styles.css: all ${sourceClasses.size} styled classes from the source are present${missingClasses.length ? ` (missing: ${missingClasses.join(', ')})` : ''}`,
);

// Counted on the raw text: an at-rule's body holds nested blocks, which the rule scanner skips.
const countMedia = (text) => (stripCssComments(text).match(/@media\b/g) ?? []).length;
check(
  countMedia(sourceText) > 0 && countMedia(distCss) === countMedia(sourceText),
  `styles.css: keeps the ${countMedia(sourceText)} responsive / print media blocks (dist has ${countMedia(distCss)})`,
);

// Vite emits every stylesheet reachable from an entry as its own file without
// referencing it from the JS, so a CSS import leaking into another entry (the
// headless core must have none) would only show up as a second file here.
const stylesheetsInDist = [];
(function collect(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) collect(path);
    else if (entry.name.endsWith('.css')) stylesheetsInDist.push(relative(root, path));
  }
})(resolve(root, 'dist'));
check(
  stylesheetsInDist.length === 1 && stylesheetsInDist[0] === pkg.exports['./styles.css'].replace(/^\.\//, ''),
  `dist holds exactly the one published stylesheet (found: ${stylesheetsInDist.join(', ') || 'none'})`,
);

// ── 6. xlsx worker chunk ────────────────────────────────────────────────────
// xlsx import and export run in a worker (src/io/xlsxWorkerClient.ts). Its
// chunk is a separate file that the entry bundles point at by name and load
// next to themselves — a dropped or renamed chunk would go unnoticed and
// silently put every read back on the main thread.
const WORKER_CHUNK = 'web-spreadsheet-xlsx-worker.js';
check(existsSync(resolve(root, 'dist', WORKER_CHUNK)), `xlsx worker chunk is emitted (dist/${WORKER_CHUNK})`);
{
  const distDir = resolve(root, 'dist');
  const scripts = readdirSync(distDir).filter((name) => /\.(js|cjs)$/.test(name));
  const mentionsChunk = (name) => readFileSync(resolve(distDir, name), 'utf8').includes(WORKER_CHUNK);
  const umd = pkg.exports['.'].require.replace(/^.*\//, '');
  check(scripts.some((name) => name === umd && mentionsChunk(name)), 'the CommonJS bundle points at the xlsx worker chunk');
  check(scripts.some((name) => name !== umd && name !== WORKER_CHUNK && mentionsChunk(name)), 'an ES chunk of the root entry points at the xlsx worker chunk');
}

// ── Result ──────────────────────────────────────────────────────────────────
if (failures.length > 0) {
  console.error(`\ncheck:dist: ${failures.length} check(s) failed`);
  process.exitCode = 1;
} else {
  console.log('\ncheck:dist: all checks passed');
}
