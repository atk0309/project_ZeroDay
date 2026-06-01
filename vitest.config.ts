import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./app/test/setup.ts'],
    include: ['app/test/**/*.test.ts'],
    globals: false,
    pool: 'forks', // each test file gets fresh module state + its own DB
    isolate: true,
  },
});
