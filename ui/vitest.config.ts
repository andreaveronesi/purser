import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts', './src/test/setup.ts'],
    coverage: {
      // Use V8's native instrumentation — reports both statement and branch
      // coverage without needing Babel transforms.
      provider: 'v8',
      reporter: ['text', 'text-summary', 'html', 'json-summary'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        // Test infrastructure
        '**/*.test.{ts,tsx}',
        '**/__tests__/**',
        'src/test/**',
        'src/test-setup.ts',
        // Pure type declarations — no runtime code to cover
        'src/api/types.ts',
        // Contract fixtures (not product code)
        'src/contract/**',
        // Entry point — thin mount, not meaningful to cover
        'src/main.tsx',
        // TS ambient declarations
        '**/*.d.ts',
      ],
      // all:true ensures uncovered files appear in the report with 0%,
      // giving the true denominator rather than only covered files.
      all: true,
      // NOTE: thresholds intentionally absent — this sprint is measurement only.
      // Uncomment and tune once baselines are established:
      //   thresholds: { statements: 0, branches: 0, functions: 0, lines: 0 },
    },
  },
});
