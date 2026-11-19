import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

await build({
  entryPoints: [fileURLToPath(new URL('src/main.ts', import.meta.url))],
  outfile: fileURLToPath(new URL('dist/dovecote.mjs', import.meta.url)),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['pg', 'mysql2', 'mysql2/promise'],
  sourcemap: true,
  legalComments: 'none',
})
