import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'packages/*/src/**/*.test.ts', 'packages/settlement/sim/**/*.test.ts', 'apps/*/src/**/*.test.ts', 'apps/demo/agents/**/*.test.ts', 'examples/*.test.ts'],
  },
});
