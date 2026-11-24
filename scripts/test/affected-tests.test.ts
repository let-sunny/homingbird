import { describe, expect, it } from 'vitest'
import { affectedTests, workspaceDependencies } from '../affected-tests.ts'

const dependencies = workspaceDependencies([
  { directory: 'kernel', manifest: { name: '@homingbird/kernel' } },
  {
    directory: 'protocol',
    manifest: { name: '@homingbird/protocol', dependencies: { '@homingbird/kernel': '*' } },
  },
  {
    directory: 'client',
    manifest: { name: '@homingbird/client', dependencies: { '@homingbird/protocol': '*' } },
  },
  { directory: 'pwa', manifest: { name: '@homingbird/pwa', devDependencies: { '@homingbird/client': '*' } } },
  { directory: 'ui', manifest: { name: '@homingbird/ui', peerDependencies: { '@homingbird/kernel': '*' } } },
  { directory: 'plugin', manifest: { name: '@homingbird/plugin', dependencies: { vitest: '*' } } },
])

const withServer = workspaceDependencies([
  { directory: 'dovecote', manifest: { name: '@homingbird/dovecote' } },
])

describe('the tests a change needs', () => {
  it('runs a changed package and every package that depends on it, directly or not', () => {
    expect(affectedTests(['packages/protocol/src/contract.ts'], dependencies)).toEqual([
      'packages/client/',
      'packages/protocol/',
      'packages/pwa/',
    ])
  })

  it('runs only the package itself when nothing depends on it', () => {
    expect(
      affectedTests(['packages/pwa/src/views/a.ts', 'packages/pwa/test/a.test.ts'], dependencies),
    ).toEqual(['packages/pwa/'])
  })

  it('follows every kind of dependency a manifest declares, and ignores outside packages', () => {
    expect(affectedTests(['packages/kernel/src/task.ts'], dependencies)).toEqual([
      'packages/client/',
      'packages/kernel/',
      'packages/protocol/',
      'packages/pwa/',
      'packages/ui/',
    ])
    expect(dependencies.get('plugin')).toEqual([])
  })

  it('runs the tests that read the plugin, which has no vitest tests of its own', () => {
    expect(affectedTests(['packages/plugin/hooks/character-rules.mjs'], dependencies)).toEqual([
      'packages/dovecote/',
      'packages/kernel/',
      'packages/protocol/',
    ])
  })

  it('runs the scripts tests when a script changes', () => {
    expect(affectedTests(['scripts/next-version.ts'], dependencies)).toEqual(['scripts/'])
  })

  it('runs nothing for documentation alone, except the documents a test reads', () => {
    expect(affectedTests(['docs/guide.md', 'docs/roadmap.md'], dependencies)).toEqual([])
    expect(affectedTests(['README.md'], withServer)).toEqual(['packages/dovecote/'])
    expect(affectedTests(['docs/deployment.md'], withServer)).toEqual(['packages/dovecote/'])
  })

  it('runs everything when a file every package shares changes', () => {
    for (const file of [
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      'tsconfig.base.json',
      'vitest.config.ts',
      'biome.json',
      '.github/workflows/ci.yml',
    ])
      expect(affectedTests([file, 'docs/guide.md'], dependencies)).toBe('everything')
  })
})
