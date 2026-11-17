import { defineConfig } from 'vitest/config'

export default defineConfig({
  esbuild: { target: 'es2022' },
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      exclude: ['**/index.ts', '**/main.ts', '**/*.d.ts'],
      reporter: ['text-summary', 'json-summary'],
    },
  },
})
