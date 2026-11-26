import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

const dirname = fileURLToPath(new URL('.', import.meta.url));

/** Packages resolved at runtime by the consumer instead of bundled. */
const RUNTIME_EXTERNALS = ['react', 'react-dom', 'antd', '@ant-design/icons', 'chart.js', 'dexie', 'xlsx', 'fflate'];

// Function form: build-only settings must not leak into vitest, which reads
// this config too (a global NODE_ENV define would force production React in
// tests and break act()).
export default defineConfig(({ command }) => ({
  // Library build must use the production JSX runtime — the dev runtime ships
  // warning strings and prop-type checks into dist.
  esbuild: { jsx: 'automatic', jsxDev: false },
  // Force react's jsx-runtime down its production branch (its CJS entry
  // switches on NODE_ENV at runtime; without this both branches bundle).
  define: command === 'build' ? { 'process.env.NODE_ENV': JSON.stringify('production') } : {},
  plugins: [
    dts({
      entryRoot: 'src',
      insertTypesEntry: true,
      rollupTypes: true,
      tsconfigPath: './tsconfig.json',
      // The tsconfig also lists tests, e2e and config files so `tsc` checks
      // them; only src is published, so only src is rolled up.
      include: ['src/**/*.{ts,tsx}'],
    }),
  ],
  // The xlsx worker (src/io/xlsxWorker.ts) is a separate chunk, loaded only
  // when a workbook is first opened or saved. A fixed name keeps it next to
  // the entry files it is resolved against.
  worker: {
    rollupOptions: {
      output: { entryFileNames: 'web-spreadsheet-xlsx-worker.js' },
    },
  },
  build: {
    lib: {
      entry: resolve(dirname, 'src/index.ts'),
      name: 'WebSpreadsheet',
      // The package is `"type": "module"`, so Node parses a `.js` file as ESM:
      // `require()` then returns an empty ES-module namespace instead of the
      // exports the UMD wrapper wrote. The `.cjs` extension makes Node load the
      // UMD bundle through the CommonJS loader, which hands back those exports.
      fileName: (format) => (format === 'umd' ? 'web-spreadsheet.umd.cjs' : `web-spreadsheet.${format}.js`),
      formats: ['es', 'umd'],
    },
    rollupOptions: {
      // Runtime deps and peers stay external so consumers' bundlers dedupe
      // them — bundling React would ship a second React instance and break
      // hooks in the host app.
      // react/jsx-runtime is bundled (tiny): React's UMD global has no jsx
      // entry, so externalizing it would emit broken `React.jsx(...)` calls.
      external: (id) => id !== 'react/jsx-runtime' && RUNTIME_EXTERNALS.some((pkg) => id === pkg || id.startsWith(`${pkg}/`)),
      output: {
        assetFileNames: 'web-spreadsheet.[ext]',
        exports: 'named',
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM',
          'react-dom/client': 'ReactDOM',
          antd: 'antd',
          '@ant-design/icons': 'icons',
          'chart.js': 'Chart',
          dexie: 'Dexie',
          xlsx: 'XLSX',
          fflate: 'fflate',
        },
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 3010,
    strictPort: true,
  },
  resolve: {
    alias: {
      '@': resolve(dirname, 'src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx', 'test/**/*.spec.ts', 'test/**/*.spec.tsx'],
    setupFiles: ['@testing-library/jest-dom/vitest', './test/setupEnv.ts'],
    // What `pnpm coverage` reports: the shipped source only. Without this the
    // table also averages in the demos, the proxy and the build scripts, which
    // no unit test loads.
    coverage: { include: ['src/**'] },
  },
}));
