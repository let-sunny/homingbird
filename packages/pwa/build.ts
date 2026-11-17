import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const here = dirname(fileURLToPath(import.meta.url))
const source = join(here, 'src')
const output = join(here, 'dist')
const repository = join(here, '..', '..')
const buildId = Date.now().toString(36)
const shared = { bundle: true, minify: true, sourcemap: true, target: 'es2022', logLevel: 'warning' } as const

await rm(output, { recursive: true, force: true })
await mkdir(join(output, 'icons'), { recursive: true })

await Promise.all([
  build({ ...shared, entryPoints: [join(source, 'main.ts')], outfile: join(output, 'app.js'), format: 'esm' }),
  build({
    ...shared,
    entryPoints: [join(source, 'service-worker.ts')],
    outfile: join(output, 'service-worker.js'),
    format: 'iife',
    define: { BUILD_ID: JSON.stringify(buildId) },
  }),
  build({ ...shared, entryPoints: [join(source, 'styles', 'app.css')], outfile: join(output, 'app.css') }),
  build({ ...shared, entryPoints: [join(source, 'styles', 'dev-login.css')], outfile: join(output, 'dev-login.css') }),
  cp(join(here, 'public'), output, { recursive: true }),
  cp(join(repository, 'docs', 'logo.svg'), join(output, 'icons', 'logo.svg')),
  writeFile(join(output, 'index.html'), await readFile(join(source, 'index.html'), 'utf8')),
])
