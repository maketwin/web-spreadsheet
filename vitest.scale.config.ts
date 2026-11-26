import { defineConfig } from 'vite';

/**
 * Scale experiments (`pnpm bench:scale`): multi-million-cell and many-sheet
 * scenarios that measure how the engine behaves at Excel's address space.
 *
 * Kept apart from `vite.config.ts` on purpose: these files are not tests of
 * correctness, they take minutes, and they want a plain Node process with the
 * GC exposed so heap numbers can be read between scenarios. Nothing here
 * matches the default unit-test include (the `.bench.ts` suffix is not one of
 * its patterns), so `pnpm test` skips it.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['test/scale/**/*.bench.ts'],
    testTimeout: 1_800_000,
    hookTimeout: 600_000,
    // One file at a time: scenarios measure wall-clock time and heap.
    fileParallelism: false,
    pool: 'forks',
    poolOptions: { forks: { execArgv: ['--expose-gc'], isolate: true } },
    reporters: ['verbose'],
  },
});
