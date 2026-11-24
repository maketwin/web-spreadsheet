import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Source stylesheets the dist stylesheet is built from (cwd = repo root). */
const srcDir = resolve(process.cwd(), 'src');
const tokensCss = readFileSync(resolve(srcDir, 'theme', 'tokens.css'), 'utf8');
const spreadsheetCss = readFileSync(resolve(srcDir, 'styles', 'spreadsheet.css'), 'utf8');
const darkCss = readFileSync(resolve(srcDir, 'theme', 'dark.css'), 'utf8');

function tokenValue(css: string, name: string): string | null {
  const match = css.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
  return match?.[1] ?? null;
}

/** WCAG 2.x relative luminance / contrast ratio (grayscale tokens suffice). */
function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Whitespace-stripped declaration body of one top-level rule, or null. */
function ruleBody(css: string, selector: string): string | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(?:^|[\\n;}])\\s*${escaped}\\s*\\{([^}]*)\\}`));
  return match === null ? null : match[1]!.replace(/\s+/g, '');
}

/** Chrome-surface tokens: light defaults equal the literals they replace. */
const SURFACE_TOKENS = {
  '--ss-surface': { light: '#ffffff', dark: '#1e1e1e' },
  '--ss-surface-alt': { light: '#f8f8f8', dark: '#252526' },
  '--ss-surface-border': { light: '#d0d0d0', dark: '#454545' },
  '--ss-toolbar-bg-start': { light: '#fafafa', dark: '#2d2d2d' },
  '--ss-toolbar-bg-end': { light: '#f0f0f0', dark: '#2d2d2d' },
  '--ss-chart-tick': { light: '#666666', dark: '#b3b3b3' },
  '--ss-chart-grid': { light: '#e5e5e5', dark: '#2b2b2b' },
  '--ss-hover-bg': { light: '#e6e6e6', dark: '#3a3a3a' },
  '--ss-tab-hover-bg': { light: '#eaeaea', dark: '#3a3a3a' },
} as const;

/** Rules whose surfaces must follow the theme, not hardcoded light values. */
const SURFACE_RULES = [
  '.ss-interaction-toolbar',
  '.ss-formula-bar',
  '.ss-formula-name',
  '.ss-formula-input',
  '.ss-sheet-tab--active',
  '.ss-bottom-bar',
  '.ss-chart-object',
] as const;

describe('dark chrome surface tokens', () => {
  it('defines every surface token in both theme blocks (light = today\'s literal value)', () => {
    for (const [name, { light, dark }] of Object.entries(SURFACE_TOKENS)) {
      expect(tokenValue(tokensCss, name)).toBe(light);
      expect(tokenValue(darkCss, name)).toBe(dark);
    }
  });

  it('chrome rules reference tokens instead of hardcoded light colours', () => {
    expect(ruleBody(spreadsheetCss, '.ss-interaction-toolbar')).toContain('background:linear-gradient(var(--ss-toolbar-bg-start),var(--ss-toolbar-bg-end))');
    expect(ruleBody(spreadsheetCss, '.ss-formula-bar')).toContain('background:var(--ss-surface)');
    expect(ruleBody(spreadsheetCss, '.ss-formula-name')).toContain('background:var(--ss-surface)');
    expect(ruleBody(spreadsheetCss, '.ss-formula-input')).toContain('background:var(--ss-surface)');
    expect(ruleBody(spreadsheetCss, '.ss-sheet-tab--active')).toContain('background:var(--ss-tab-active-bg)');
    expect(ruleBody(spreadsheetCss, '.ss-bottom-bar')).toContain('background:var(--ss-tab-inactive-bg)');
    for (const selector of SURFACE_RULES) {
      expect(ruleBody(spreadsheetCss, selector)).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
    }
  });

  it('.ss-chart-object paints its surface and border with theme tokens', () => {
    const body = ruleBody(spreadsheetCss, '.ss-chart-object');
    expect(body).toContain('background:var(--ss-surface)');
    expect(body).toContain('border:1pxsolidvar(--ss-surface-border)');
  });

  it('dark surfaces keep their text readable (WCAG AA ≥ 4.5:1)', () => {
    const darkText = tokenValue(darkCss, '--ss-text')!;
    const darkAccent = tokenValue(darkCss, '--ss-accent')!;
    expect(contrast(darkText, SURFACE_TOKENS['--ss-surface'].dark)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(SURFACE_TOKENS['--ss-chart-tick'].dark, SURFACE_TOKENS['--ss-surface'].dark)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(darkText, tokenValue(darkCss, '--ss-tab-inactive-bg')!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(darkAccent, tokenValue(darkCss, '--ss-tab-active-bg')!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(darkAccent, SURFACE_TOKENS['--ss-surface-alt'].dark)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('--ss-header-text theme tokens', () => {
  it('keeps the light theme value at the Excel dark gray #444444', () => {
    expect(tokenValue(tokensCss, '--ss-header-text')).toBe('#444444');
  });

  it('overrides the token for the dark theme (dark.css does not define it)', () => {
    const block = spreadsheetCss.match(/:root\[data-spreadsheet-theme="dark"\]\s*\{([^}]*)\}/);
    expect(block).not.toBeNull();
    expect(tokenValue(block![1]!, '--ss-header-text')).toMatch(/^#[0-9a-fA-F]{6}$/);
    // The dark override must differ from the light value — otherwise it is no override.
    expect(tokenValue(block![1]!, '--ss-header-text')).not.toBe('#444444');
  });

  it('dark header text is readable on the dark header background (WCAG AA)', () => {
    const darkText = tokenValue(spreadsheetCss, '--ss-header-text')!;
    const darkBg = tokenValue(darkCss, '--ss-header-bg')!;
    expect(contrast(darkText, darkBg)).toBeGreaterThanOrEqual(4.5);
  });

  it('light header text stays readable on the light header background', () => {
    const lightText = tokenValue(tokensCss, '--ss-header-text')!;
    const lightBg = tokenValue(tokensCss, '--ss-header-bg')!;
    expect(contrast(lightText, lightBg)).toBeGreaterThanOrEqual(4.5);
  });
});
