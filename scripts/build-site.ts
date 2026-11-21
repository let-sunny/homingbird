import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, posix } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(import.meta.dirname, '..')
const OUTPUT = join(ROOT, 'site-dist')
const REPOSITORY_FILES = 'https://github.com/let-sunny/homingbird/blob/main/'

/** The documents appended to llms.txt, in order, each under its own heading. */
const FULL_DOCUMENTS: ReadonlyArray<readonly [string, string]> = [
  ['docs/guide.md', 'Guide'],
  ['docs/deployment.md', 'Deployment'],
  ['.claude/rules/security.md', 'Security rules'],
  ['SECURITY.md', 'Security policy'],
]

const COPIED_ASSETS: ReadonlyArray<readonly [string, string]> = [
  ['assets/fonts', 'fonts'],
  ['docs/screenshots', 'screenshots'],
  ['assets/brand/homingbird-mark.svg', 'brand/homingbird-mark.svg'],
  ['assets/brand/homingbird-icon-180.png', 'brand/homingbird-icon-180.png'],
  ['assets/brand/favicon.ico', 'brand/favicon.ico'],
]

export const buildSite = (): void => {
  rmSync(OUTPUT, { recursive: true, force: true })
  cpSync(join(ROOT, 'site'), OUTPUT, { recursive: true })
  for (const [source, target] of COPIED_ASSETS) {
    mkdirSync(dirname(join(OUTPUT, target)), { recursive: true })
    cpSync(join(ROOT, source), join(OUTPUT, target), { recursive: true })
  }
  writeFileSync(join(OUTPUT, 'llms-full.txt'), llmsFull(readRepositoryFile))
  writeFileSync(join(OUTPUT, '.nojekyll'), '')
  buildDemo()
}

/** The demo's own build writes `site-dist/demo/`; until it exists the page links to a missing demo. */
const buildDemo = (): void => {
  if (!hasDemoBuild()) {
    process.stdout.write('No build:demo script yet; the site is built without the demo.\n')
    return
  }
  execFileSync('pnpm', ['run', 'build:demo'], { cwd: ROOT, stdio: 'inherit' })
  if (!existsSync(join(OUTPUT, 'demo', 'index.html'))) {
    throw new Error('pnpm build:demo did not write site-dist/demo/index.html')
  }
}

const readRepositoryFile = (path: string): string => readFileSync(join(ROOT, path), 'utf8')

const hasDemoBuild = (): boolean => {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>
  }
  return manifest.scripts?.['build:demo'] !== undefined
}

/** llms.txt followed by each document in full, read through `read` from a path in the repository. */
export const llmsFull = (read: (path: string) => string): string => {
  const sections = FULL_DOCUMENTS.map(
    ([path, title]) =>
      `\n\n---\n\n# ${title}\n\nSource: ${REPOSITORY_FILES}${path}\n\n${withAbsoluteLinks(read(path), path)}`,
  )
  return `${read('site/llms.txt').trimEnd()}${sections.join('')}\n`
}

/** Relative links in a document point into the repository, so they become links on GitHub. */
export const withAbsoluteLinks = (markdown: string, path: string): string =>
  markdown.replace(/\]\(([^)\s]+)\)/g, (link, target: string) =>
    /^([a-z]+:|#)/i.test(target)
      ? link
      : `](${REPOSITORY_FILES}${posix.normalize(posix.join(posix.dirname(path), target))})`,
  )

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  buildSite()
}
