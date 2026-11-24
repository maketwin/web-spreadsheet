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
  // 分层强制①：内核层（store/formula/commands/events）不得依赖 UI/渲染/平台/
  // IO/持久化或任何三方 UI 库——冻结现状（2026-11 时全部为零违例）。
  {
    files: ['src/{store,formula,commands,events}/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['react', 'react-dom', 'antd', '@ant-design/*', 'chart.js'],
            message: '内核层不得依赖 React/antd/chart.js —— headless core 保持零三方依赖。',
          },
          {
            group: ['**/components/**', '**/renderer/**', '**/platform/**', '**/io/**', '**/db/**'],
            message: '分层违规：内核层（store/formula/commands/events）只能向下依赖 util/types，不得 import UI、渲染器、平台或 IO 模块。',
          },
          {
            // charts/ 与 sparkline/ 里的纯模块（types/geometry/anchorShift/values）是共享内核，
            // 内核层可用；只禁真正拉入 react/chart.js 的 UI 文件。
            group: ['**/charts/FloatingChart*', '**/charts/FloatingImage*', '**/sparkline/Sparkline*'],
            message: 'UI 文件（依赖 react/chart.js）不得被内核层 import；纯模块 charts/{types,geometry,anchorShift} 不受限。',
          },
        ],
      }],
    },
  },
  // 分层强制②：platform 核心零引擎依赖。引擎值依赖只允许出现在 4 个适配文件
  //（apiFunctions/replay/deps/PlatformPanel）；类型导入（import type）不受限，
  // bundle/opDetail/operationRecorder 的 SerializedStore/Command 等类型引用合法。
  {
    files: ['src/platform/**/*.ts', 'src/platform/**/*.tsx'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['../store/**', '../commands/**', '../formula/**', '../events/**'],
            allowTypeImports: true,
            message: 'platform 核心零引擎依赖：引擎访问只允许出现在适配文件 apiFunctions.ts / replay.ts / deps.ts / PlatformPanel.tsx。',
          },
        ],
      }],
    },
  },
  {
    files: ['src/platform/{apiFunctions,replay,deps,PlatformPanel}.ts', 'src/platform/{apiFunctions,replay,deps,PlatformPanel}.tsx'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
];
