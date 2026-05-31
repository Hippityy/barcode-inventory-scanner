import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
  },
});
