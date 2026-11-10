import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/*/test/**/*.test.ts',
      'scripts/test/**/*.test.ts',
      'site/tests/**/*.test.ts',
      'bench/refs/test/**/*.test.ts',
      'evals/test/**/*.test.ts',
      'packaging/*.test.ts',
    ],
    testTimeout: 20000,
  },
});
