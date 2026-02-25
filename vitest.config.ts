import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['rde-coding-agent/tests/**/*.test.ts'],
  },
});
