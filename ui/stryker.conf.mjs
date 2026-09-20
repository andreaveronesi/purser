// Stryker mutation testing configuration for the Purser UI.
//
// Run full mutation suite:  npm run test:mutation
// Scope to a single file:   npx stryker run --mutate 'src/lib/format.ts'
// Incremental (skip clean):  the incremental.json cache is updated automatically.
//
// concurrency:2 — conservative for a shared dev machine where parallel subagents
// may run simultaneously. Raise if running alone on a quiet box.

/** @type {import('@stryker-mutator/core').PartialStrykerOptions} */
export default {
  testRunner: 'vitest',
  mutate: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.test.{ts,tsx}',
    '!src/**/__tests__/**',
    '!src/test/**',
    '!src/test-setup.ts',
    // Pure type declarations — no runtime mutants possible
    '!src/api/types.ts',
    // Contract fixtures (static JSON-like data, not logic)
    '!src/contract/**',
    // Entry point — thin React mount
    '!src/main.tsx',
  ],
  coverageAnalysis: 'perTest',
  concurrency: 2,
  reporters: ['clear-text', 'html', 'json'],
  // Skip the TypeScript type-check pass to keep mutation runs fast.
  // Re-enable if type errors start masking real mutation kills.
  checkers: [],
  tempDirName: '.stryker-tmp',
  // Incremental mode: only mutants that changed since the last run are tested,
  // which dramatically reduces repeat-run time.
  incremental: true,
  incrementalFile: '.stryker-tmp/incremental.json',
  htmlReporter: {
    fileName: 'reports/mutation/index.html',
  },
  jsonReporter: {
    fileName: 'reports/mutation/mutation.json',
  },
};
