import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

const dirname = fileURLToPath(new URL('.', import.meta.url));

/**
 * Second library build: the headless core entry (`web-spreadsheet/core`).
 *
 * Runs after the main build (`pnpm build` chains both). emptyOutDir stays
 * false so it appends to dist/ instead of wiping the main bundle. The core
 * graph must not touch antd/chart.js/xlsx/dexie — enforced downstream by
 * grepping the artifact in CI-style verification.
 */
export default defineConfig({
  esbuild: { jsx: 'automatic', jsxDev: false },
  plugins: [
    dts({
      entryRoot: 'src',
      // Per-file emit. The declaration plugin always rolls up towards the
      // package's top-level `types` file (the main build's bundled
      // index.d.ts), so a second rolled-up entry cannot be produced this way;
      // a tree of per-module declarations plus core.d.ts resolves through
      // package.json exports "./core". types. The main entry is left out on
      // purpose — emitting it here used to overwrite the bundled index.d.ts
      // with its unrolled form.
      exclude: ['src/index.ts'],
      insertTypesEntry: true,
      tsconfigPath: './tsconfig.json',
    }),
  ],
  build: {
    emptyOutDir: false,
    lib: {
      entry: resolve(dirname, 'src/core.ts'),
      name: 'WebSpreadsheetCore',
      fileName: () => 'web-spreadsheet-core.es.js',
      formats: ['es'],
    },
    rollupOptions: {
      // Same external set as the main build: core should not import any of
      // them, but keeping the list identical makes a future leak fail the
      // artifact grep instead of silently bundling 700 KB of antd.
      external: (id: string) =>
        id !== 'react/jsx-runtime' &&
        ['react', 'react-dom', 'antd', '@ant-design/icons', 'chart.js', 'dexie', 'xlsx', 'fflate'].some(
          (pkg) => id === pkg || id.startsWith(`${pkg}/`),
        ),
      output: {
        exports: 'named',
      },
    },
  },
});
