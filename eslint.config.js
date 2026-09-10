import eslintPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

const browserGlobals = {
  window: 'readonly',
  document: 'readonly',
  navigator: 'readonly',
  localStorage: 'readonly',
  sessionStorage: 'readonly',
  requestAnimationFrame: 'readonly',
  cancelAnimationFrame: 'readonly',
  getComputedStyle: 'readonly',
  ResizeObserver: 'readonly',
  MutationObserver: 'readonly',
  CustomEvent: 'readonly',
  Event: 'readonly',
  KeyboardEvent: 'readonly',
  MouseEvent: 'readonly',
  HTMLElement: 'readonly',
  HTMLCanvasElement: 'readonly',
  HTMLInputElement: 'readonly',
  HTMLTextAreaElement: 'readonly',
  CanvasRenderingContext2D: 'readonly',
  WebSocket: 'readonly',
  URL: 'readonly',
  Blob: 'readonly',
  File: 'readonly',
  FileReader: 'readonly',
};

const vitestGlobals = {
  describe: 'readonly',
  it: 'readonly',
  expect: 'readonly',
  beforeEach: 'readonly',
  afterEach: 'readonly',
  beforeAll: 'readonly',
  afterAll: 'readonly',
  vi: 'readonly',
};

export default [
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**', '.pnpm-store/**', 'docs/.vitepress/dist/**', 'docs/.vitepress/cache/**'],
  },
  ...eslintPlugin.configs['flat/recommended'],
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...browserGlobals,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'none',
      }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/consistent-type-imports': ['warn', {
        prefer: 'type-imports',
        fixStyle: 'inline-type-imports',
      }],
    },
  },
  {
    files: ['test/**/*.{ts,tsx}', 'src/**/*.{test,spec}.{ts,tsx}'],
    languageOptions: {
      globals: vitestGlobals,
    },
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
];
