import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { type PipSheet, pipStylesheet } from '../pwa/src/pip-stylesheet.ts'
import { type TurnSheet, turnStylesheet } from '../pwa/src/turn-stylesheet.ts'

const here = dirname(fileURLToPath(import.meta.url))
const repository = join(here, '..', '..')
const pwa = join(repository, 'packages', 'pwa')
const assets = join(repository, 'assets')
const output = process.env.HB_DEMO_OUT ?? join(repository, 'site-dist', 'demo')
const shared = { bundle: true, minify: true, sourcemap: true, target: 'es2022', logLevel: 'warning' } as const

/** The pwa's stylesheet names its fonts from the server's root; the demo is served from a folder. */
const relativeUrls = (css: string): string => css.replace(/url\((["']?)\/(fonts|pip|icons)\//g, 'url($1$2/')

await rm(output, { recursive: true, force: true })
for (const directory of ['icons', 'fonts/pretendard', 'pip'])
  await mkdir(join(output, directory), { recursive: true })

const pipSheet = JSON.parse(await readFile(join(assets, 'pip', 'pip-sheet.json'), 'utf8')) as PipSheet
const turnSheet = JSON.parse(await readFile(join(assets, 'pip', 'pip-turn.json'), 'utf8')) as TurnSheet
const brandFiles: ReadonlyArray<readonly [string, string]> = [
  ['brand/homingbird-mark.svg', 'icons/mark.svg'],
  ['brand/homingbird-icon-180.png', 'icons/icon-180.png'],
  ['brand/favicon.ico', 'favicon.ico'],
  ['pip/pip-sheet@1x.png', 'pip/pip-sheet.png'],
  ['pip/pip-turn@1x.png', 'pip/pip-turn.png'],
]

const [, styles] = await Promise.all([
  build({
    ...shared,
    entryPoints: [join(here, 'src', 'main.ts')],
    outfile: join(output, 'app.js'),
    format: 'esm',
  }),
  build({
    ...shared,
    sourcemap: false,
    write: false,
    entryPoints: [join(pwa, 'src', 'styles', 'app.css')],
    outfile: join(output, 'app.css'),
    external: ['/fonts/*', '/pip/*', '/icons/*'],
  }),
  writeFile(
    join(output, 'pip.css'),
    pipStylesheet(pipSheet, 'pip/pip-sheet.png') + turnStylesheet(turnSheet, 'pip/pip-turn.png'),
  ),
  cp(join(here, 'src', 'demo.css'), join(output, 'demo.css')),
  cp(join(here, 'src', 'index.html'), join(output, 'index.html')),
  cp(join(assets, 'fonts', 'pretendard'), join(output, 'fonts', 'pretendard'), { recursive: true }),
  ...brandFiles.map(([from, to]) => cp(join(assets, from), join(output, to))),
])
await writeFile(join(output, 'app.css'), relativeUrls(styles.outputFiles[0]!.text))
