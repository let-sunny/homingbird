import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const JSON_VERSION = /^(\s*"version":\s*)"[^"]*"/m
const CONSTANT_VERSION = /^(export const \w+_VERSION = )'[^']*'/m
const VERSION_CONSTANTS = ['packages/mcp/src/version.ts', 'packages/dovecote/src/version.ts']

const repositoryRoot = join(import.meta.dirname, '..')
const requested = (process.argv[2] ?? '').replace(/^v/, '')

if (!SEMVER.test(requested)) {
  process.stderr.write('Usage: pnpm set-version <version>, for example 0.2.0 or v0.2.0-rc.1\n')
  process.exit(2)
}

const manifests = [
  'package.json',
  ...readdirSync(join(repositoryRoot, 'packages')).map((name) => `packages/${name}/package.json`),
  'packages/mod/.claude-plugin/plugin.json',
].filter((file) => readOrNull(file) !== null)

for (const file of manifests) rewrite(file, JSON_VERSION, `$1"${requested}"`)
for (const file of VERSION_CONSTANTS) rewrite(file, CONSTANT_VERSION, `$1'${requested}'`)
process.stdout.write(`Version ${requested} in ${manifests.length + VERSION_CONSTANTS.length} files.\n`)

function rewrite(file: string, pattern: RegExp, replacement: string): void {
  const text = readOrNull(file)
  if (text === null || !pattern.test(text)) {
    process.stderr.write(`${file} has no version to set.\n`)
    process.exit(1)
  }
  writeFileSync(join(repositoryRoot, file), text.replace(pattern, replacement))
}

function readOrNull(file: string): string | null {
  try {
    return readFileSync(join(repositoryRoot, file), 'utf8')
  } catch {
    return null
  }
}
