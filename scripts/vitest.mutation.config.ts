import { defineConfig } from 'vitest/config'

const MUTATED_PACKAGES = ['kernel', 'protocol']

const selected = process.env.MUTATION_PACKAGE ? [process.env.MUTATION_PACKAGE] : MUTATED_PACKAGES

export default defineConfig({
  root: new URL('..', import.meta.url).pathname,
  esbuild: { target: 'es2022' },
  test: { include: selected.map((name) => `packages/${name}/test/**/*.test.ts`) },
})
