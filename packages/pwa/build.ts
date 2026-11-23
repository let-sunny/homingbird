import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { type PipSheet, pipStylesheet } from './src/pip-stylesheet.ts'
import { type TurnSheet, turnStylesheet } from './src/turn-stylesheet.ts'

const here = dirname(fileURLToPath(import.meta.url))
const source = join(here, 'src')
const output = join(here, 'dist')
const repository = join(here, '..', '..')
const buildId = Date.now().toString(36)
const assets = join(repository, 'assets')
const shared = { bundle: true, minify: true, sourcemap: true, target: 'es2022', logLevel: 'warning' } as const

await rm(output, { recursive: true, force: true })
for (const directory of ['icons', 'fonts', 'pip']) await mkdir(join(output, directory), { recursive: true })

const pipSheet = JSON.parse(await readFile(join(assets, 'pip', 'pip-sheet.json'), 'utf8')) as PipSheet
const turnSheet = JSON.parse(await readFile(join(assets, 'pip', 'pip-turn.json'), 'utf8')) as TurnSheet
const styles = { ...shared, external: ['/fonts/*', '/pip/*', '/icons/*'] }
const brandFiles: ReadonlyArray<readonly [string, string]> = [
  ['brand/homingbird-mark.svg', 'icons/mark.svg'],
  ['brand/homingbird-mark-64.png', 'icons/mark-64.png'],
  ['brand/homingbird-icon.svg', 'icons/icon.svg'],
  ['brand/homingbird-icon-180.png', 'icons/icon-180.png'],
  ['brand/homingbird-icon-192.png', 'icons/icon-192.png'],
  ['brand/homingbird-icon-512.png', 'icons/icon-512.png'],
  ['brand/favicon.ico', 'favicon.ico'],
  ['pip/pip-sheet@1x.png', 'pip/pip-sheet.png'],
  ['pip/pip-turn@1x.png', 'pip/pip-turn.png'],
  ['fonts/inter-latin-wght-normal.woff2', 'fonts/inter-latin-wght-normal.woff2'],
  ['fonts/inter-latin-ext-wght-normal.woff2', 'fonts/inter-latin-ext-wght-normal.woff2'],
  ['fonts/bricolage-grotesque-latin-wght-normal.woff2', 'fonts/bricolage-grotesque-latin-wght-normal.woff2'],
  ['fonts/Inter-LICENSE.txt', 'fonts/Inter-LICENSE.txt'],
  ['fonts/BricolageGrotesque-LICENSE.txt', 'fonts/BricolageGrotesque-LICENSE.txt'],
]

await Promise.all([
  build({
    ...shared,
    entryPoints: [join(source, 'main.ts')],
    outfile: join(output, 'app.js'),
    format: 'esm',
  }),
  build({
    ...shared,
    entryPoints: [join(source, 'service-worker.ts')],
    outfile: join(output, 'service-worker.js'),
    format: 'iife',
    define: { BUILD_ID: JSON.stringify(buildId) },
  }),
  build({ ...styles, entryPoints: [join(source, 'styles', 'app.css')], outfile: join(output, 'app.css') }),
  build({
    ...styles,
    entryPoints: [join(source, 'styles', 'dev-login.css')],
    outfile: join(output, 'dev-login.css'),
  }),
  writeFile(
    join(output, 'pip.css'),
    pipStylesheet(pipSheet, '/pip/pip-sheet.png') + turnStylesheet(turnSheet, '/pip/pip-turn.png'),
  ),
  ...brandFiles.map(([from, to]) => cp(join(assets, from), join(output, to))),
  cp(join(here, 'public'), output, { recursive: true }),
  writeFile(join(output, 'index.html'), await readFile(join(source, 'index.html'), 'utf8')),
])
