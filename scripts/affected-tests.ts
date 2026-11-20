import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The test paths a change needs: every changed package and every package that depends on one, or
 * `everything` when a shared file changed. An empty list means no test needs to run.
 */
export const affectedTests = (
  changedFiles: ReadonlyArray<string>,
  dependencies: ReadonlyMap<string, ReadonlyArray<string>>,
): 'everything' | ReadonlyArray<string> => {
  if (changedFiles.some(isShared)) return 'everything'
  const changed = new Set(changedFiles.flatMap((file) => packageOf(file) ?? READ_BY_TESTS[file] ?? []))
  const affected = withDependents(changed, dependencies)
  const scripts = changedFiles.some((file) => file.startsWith('scripts/')) ? ['scripts/'] : []
  return [...[...affected].sort().map((name) => `packages/${name}/`), ...scripts]
}

/** Each package directory's name with the names of the workspace packages it depends on. */
export const workspaceDependencies = (
  manifests: ReadonlyArray<{ readonly directory: string; readonly manifest: Manifest }>,
): ReadonlyMap<string, ReadonlyArray<string>> => {
  const directoryOf = new Map(manifests.map(({ directory, manifest }) => [manifest.name, directory]))
  return new Map(
    manifests.map(({ directory, manifest }) => [
      directory,
      Object.keys({
        ...manifest.dependencies,
        ...manifest.devDependencies,
        ...manifest.peerDependencies,
      }).flatMap((name) => directoryOf.get(name) ?? []),
    ]),
  )
}

export type Manifest = {
  readonly name: string
  readonly dependencies?: Readonly<Record<string, string>>
  readonly devDependencies?: Readonly<Record<string, string>>
  readonly peerDependencies?: Readonly<Record<string, string>>
}

const withDependents = (
  changed: ReadonlySet<string>,
  dependencies: ReadonlyMap<string, ReadonlyArray<string>>,
): ReadonlySet<string> => {
  const affected = new Set(changed)
  let grew = true
  while (grew) {
    grew = false
    for (const [name, needs] of dependencies)
      if (!affected.has(name) && needs.some((need) => affected.has(need))) {
        affected.add(name)
        grew = true
      }
  }
  return affected
}

const packageOf = (file: string): string | null => /^packages\/([^/]+)\//.exec(file)?.[1] ?? null

const isShared = (file: string): boolean => SHARED.some((pattern) => pattern.test(file))

// Documents a package's tests read, so a change to one runs those tests.
const READ_BY_TESTS: Readonly<Record<string, string>> = {
  'README.md': 'dovecote',
  'docs/deployment.md': 'dovecote',
}

const SHARED = [
  /^package\.json$/,
  /^pnpm-lock\.yaml$/,
  /^pnpm-workspace\.yaml$/,
  /^tsconfig[^/]*\.json$/,
  /^vitest\.config\.ts$/,
  /^biome\.json$/,
  /^\.github\/workflows\//,
]

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const manifests = readdirSync(join(root, 'packages'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      directory: entry.name,
      manifest: JSON.parse(
        readFileSync(join(root, 'packages', entry.name, 'package.json'), 'utf8'),
      ) as Manifest,
    }))
  const files = readFileSync(0, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
  const tests = affectedTests(files, workspaceDependencies(manifests))
  process.stdout.write(`${tests === 'everything' ? 'everything' : tests.join(' ')}\n`)
}
