import { defineConfig } from 'vitest/config'

export default defineConfig({
  esbuild: { target: 'es2022' },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'scripts/test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      exclude: ['**/index.ts', '**/main.ts', '**/*.d.ts'],
      reporter: ['text-summary', 'json-summary'],
      thresholds: {
        'packages/kernel/src/**': { statements: 100, branches: 100, functions: 100, lines: 100 },
        'packages/a2a/src/**': { statements: 100, branches: 100, functions: 100, lines: 100 },
        'packages/protocol/src/**': { statements: 100, branches: 100, functions: 100, lines: 100 },
        'packages/client/src/**': { statements: 100, branches: 100, functions: 100, lines: 100 },
        'packages/dovecote/src/**': { statements: 96, branches: 92, functions: 96, lines: 96 },
      },
    },
  },
})
